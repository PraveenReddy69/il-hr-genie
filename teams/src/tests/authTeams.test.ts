/**
 * The wire contract for trading a Teams identity for an HR Genie session.
 *
 * Everything else about SSO is tested with the network stubbed out, which proves the
 * logic and proves nothing about the request that actually leaves the process. This
 * runs a real server on a real port and asserts what arrives, because the backend has
 * to match it exactly and the endpoint does not exist yet — when it does, a failure
 * here is the difference between "their bug" and "ours".
 *
 * See docs/TEAMS_SSO_BACKEND.md, which this file is the executable half of.
 */

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { after, before, describe, it } from 'node:test'
import type { AddressInfo } from 'node:net'

/** What the last request carried, so a test can assert on it. */
interface Seen {
  method: string
  url: string
  contentType: string | undefined
  authorization: string | undefined
  body: unknown
}

let server: Server
let seen: Seen | undefined
/** What the next request should be answered with. */
let reply: { status: number; body: string } = { status: 200, body: '{}' }

/** Imported after the base URL is pointed at this server — see [before]. */
let exchangeTeamsToken: (token: string) => Promise<{ employeeId: string; name: string; token: string }>
let ApiError: new (message: string, status?: number) => Error

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

before(async () => {
  server = createServer(async (request, response) => {
    seen = {
      method: request.method ?? '',
      url: request.url ?? '',
      contentType: request.headers['content-type'],
      authorization: request.headers.authorization,
      body: await readBody(request),
    }
    response.writeHead(reply.status, { 'Content-Type': 'application/json' })
    response.end(reply.body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  // The module reads its base URL once, at load. Set it first, then import.
  process.env.HRGENIE_BASE_URL = `http://127.0.0.1:${port}`
  const api = await import('../api.js')
  exchangeTeamsToken = api.exchangeTeamsToken as typeof exchangeTeamsToken
  ApiError = api.ApiError as typeof ApiError
})

after(() => {
  server.close()
})

const ok = (body: unknown) => {
  reply = { status: 200, body: JSON.stringify(body) }
}

const SESSION = {
  token: 'hrgenie-bearer',
  employee: { employeeId: 'EMP3801', name: 'Gunapati Praveen' },
}

describe('trading a Teams token for a session', () => {
  it('posts the Entra token to /api/auth/teams as JSON', async () => {
    ok(SESSION)
    await exchangeTeamsToken('entra-access-token')

    assert.equal(seen?.method, 'POST')
    assert.equal(seen?.url, '/api/auth/teams')
    assert.match(seen?.contentType ?? '', /application\/json/)
    assert.deepEqual(seen?.body, { token: 'entra-access-token' })
  })

  it('sends no bearer of its own — the Entra token is the credential', async () => {
    ok(SESSION)
    await exchangeTeamsToken('entra-access-token')

    // Anything here would be the shared account's token, which is the identity this
    // whole feature exists to stop using.
    assert.equal(seen?.authorization, undefined)
  })

  it('returns the employee the backend resolved, not the one in .env', async () => {
    ok(SESSION)
    const session = await exchangeTeamsToken('entra-access-token')

    assert.deepEqual(session, {
      employeeId: 'EMP3801',
      name: 'Gunapati Praveen',
      token: 'hrgenie-bearer',
    })
  })

  it('falls back to the id when the backend sends no display name', async () => {
    ok({ token: 'hrgenie-bearer', employee: { employeeId: 'EMP3801' } })
    const session = await exchangeTeamsToken('entra-access-token')

    assert.equal(session.name, 'EMP3801')
  })

  it('refuses a response with no employee rather than inventing one', async () => {
    ok({ token: 'hrgenie-bearer' })

    await assert.rejects(
      () => exchangeTeamsToken('entra-access-token'),
      (error: Error) => error instanceof ApiError && /no employee/i.test(error.message),
    )
  })

  it('refuses a response with an employee but no bearer', async () => {
    // Without a token every later call would fall back to the shared account, which
    // would look like it worked and quietly serve the wrong person's records.
    ok({ employee: { employeeId: 'EMP3801', name: 'Gunapati Praveen' } })

    await assert.rejects(
      () => exchangeTeamsToken('entra-access-token'),
      (error: Error) => error instanceof ApiError,
    )
  })

  it('surfaces a rejected token with its status, so the caller can re-prompt', async () => {
    reply = {
      status: 401,
      body: JSON.stringify({ message: 'Teams token failed validation', statusCode: 401 }),
    }

    await assert.rejects(
      () => exchangeTeamsToken('stale-token'),
      (error: Error) => error instanceof ApiError && (error as { status?: number }).status === 401,
    )
  })

  it('reports a route that does not exist yet as a 404, not a crash', async () => {
    // Exactly what the deployed backend returns today.
    reply = {
      status: 404,
      body: JSON.stringify({
        message: 'Cannot POST /api/auth/teams',
        error: 'Not Found',
        statusCode: 404,
      }),
    }

    await assert.rejects(
      () => exchangeTeamsToken('entra-access-token'),
      (error: Error) =>
        error instanceof ApiError &&
        (error as { status?: number }).status === 404 &&
        /Cannot POST/.test(error.message),
    )
  })
})
