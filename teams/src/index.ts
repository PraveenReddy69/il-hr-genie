/**
 * The bot's HTTP endpoint.
 *
 * With no app id configured the adapter accepts unauthenticated requests, which is
 * what lets the Bot Framework Emulator talk to it locally. Teams itself needs a real
 * registration — see the README.
 */

import 'dotenv/config'
import { CloudAdapter, ConfigurationBotFrameworkAuthentication } from 'botbuilder'
import express from 'express'
import { HrGenieBot } from './bot.js'
import { DEV_CHAT_HTML, devTurn } from './devChat.js'

const auth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID,
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD,
  // Defaults to SingleTenant: this bot serves one organisation. See .env.example.
  MicrosoftAppType: process.env.MICROSOFT_APP_TYPE ?? 'SingleTenant',
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
})

const adapter = new CloudAdapter(auth)

adapter.onTurnError = async (context, error) => {
  // Never leave the employee looking at silence. The detail goes to the log, not to
  // them — a stack trace in a chat window helps nobody.
  console.error('[HrGenieBot] turn failed', error)
  await context.sendActivity(
    'Something went wrong at my end. Try again in a moment — nothing was sent to HR.',
  )
}

const bot = new HrGenieBot()

// Express rather than restify: restify still calls process.binding('http_parser'),
// which modern Node removed, so it will not even load.
const server = express()
server.use(express.json())

server.post('/api/messages', async (request, response) => {
  await adapter.process(request, response, (context) => bot.run(context))
})

// A browser chat window for developing the cards. Development only — no auth, and
// it shares one conversation per id. See devChat.ts.
server.get('/dev', (_request, response) => {
  response.type('html').send(DEV_CHAT_HTML)
})

server.post('/dev/turn', async (request, response) => {
  try {
    response.json(await devTurn(request.body))
  } catch (error) {
    console.error('[HrGenieBot] dev turn failed', error)
    response.status(500).json([{ text: 'Something went wrong at my end.' }])
  }
})

/** So a tunnel or a health check can tell the process is up without posting an activity. */
server.get('/healthz', (_request, response) => {
  response.json({ ok: true })
})

const port = Number(process.env.PORT ?? 3978)
server.listen(port, () => {
  console.log(`[HrGenieBot] listening on http://localhost:${port}/api/messages`)
  console.log(`[HrGenieBot] card preview at http://localhost:${port}/dev`)
})
