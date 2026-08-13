/**
 * The bot's HTTP endpoint.
 *
 * With no app id configured the adapter accepts unauthenticated requests, which is
 * what lets the Bot Framework Emulator talk to it locally. Teams itself needs a real
 * registration — see the README.
 */

import 'dotenv/config'
import {
  CardFactory,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  MessageFactory,
} from 'botbuilder'
import express from 'express'
import { HrGenieBot } from './bot.js'
import { BotFrameworkTokens, Sso } from './sso.js'
import { checkInReminderCard, ticketMovedCard } from './cards.js'
import { DEV_CHAT_HTML, devTurn } from './devChat.js'
import {
  CELEBRATIONS_HTML,
  HOLIDAYS_HTML,
  PULSE_HTML,
  TICKETS_HTML,
  celebrationsJson,
  holidaysJson,
  pulseJson,
  ticketsJson,
  savePulseJson,
} from './tab.js'
import { References, handleNotify } from './notify.js'

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

/**
 * Where conversations are kept between restarts.
 *
 * A reference is only handed over when someone talks to the bot, so losing them on
 * restart would mean nobody gets a notification until they next open the chat — the
 * exact thing notifications exist to avoid.
 */
const references = new References(process.env.REFERENCES_FILE ?? 'data/references.json')

/**
 * SSO is on only when an OAuth connection is named.
 *
 * Unset — the Emulator, `npm run try`, any run without a bot registration — the bot
 * falls back to the single account in `.env`, which is why it must stay sideloaded to
 * one person until this is configured. See docs/TEAMS_SSO_BACKEND.md.
 */
const ssoConnection = process.env.SSO_CONNECTION_NAME
const sso = ssoConnection ? new Sso(new BotFrameworkTokens(ssoConnection)) : undefined
if (!sso) {
  console.warn(
    '[HrGenieBot] SSO_CONNECTION_NAME is not set — every user will be treated as ' +
      `${process.env.HRGENIE_EMPLOYEE_ID ?? 'the configured account'}. Do not share this bot.`,
  )
}

const bot = new HrGenieBot(references, sso, ssoConnection)

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

/**
 * The "Around the team" personal tab, and the data it reads.
 *
 * Both under /tab so the page and its fetch share an origin — a tab served from
 * somewhere else would need CORS on this endpoint and a second thing to deploy.
 */
const PAGES: Record<string, string> = {
  celebrations: CELEBRATIONS_HTML,
  pulse: PULSE_HTML,
  holidays: HOLIDAYS_HTML,
  tickets: TICKETS_HTML,
}

server.get('/tab/:page', (request, response) => {
  const html = PAGES[request.params.page]
  if (!html) return response.status(404).send('No such tab.')
  response.type('html').send(html)
})

/** Wraps a tab's data call so a backend outage is a message, not a blank page. */
const tabData = (name: string, load: () => Promise<unknown> | unknown) =>
  async (_request: express.Request, response: express.Response) => {
    try {
      response.json(await load())
    } catch (error) {
      console.warn(`[HrGenieBot] tab ${name} failed`, error)
      response.status(502).json({ error: 'Could not reach the HR service.' })
    }
  }

server.get('/tab/api/celebrations', tabData('celebrations', celebrationsJson))
server.get('/tab/api/pulse', tabData('pulse', pulseJson))
server.get('/tab/api/holidays', tabData('holidays', () => holidaysJson()))
server.get('/tab/api/tickets', tabData('tickets', ticketsJson))

server.post('/tab/api/pulse', async (request, response) => {
  try {
    response.json(await savePulseJson(request.body as Record<string, string>))
  } catch (error) {
    console.warn('[HrGenieBot] tab could not save the pulse', error)
    response.status(502).json({ error: 'Could not save that.' })
  }
})

/**
 * Where the backend tells us a ticket moved.
 *
 * Same hook as the FCM push in the Android app: called after the status write
 * commits, and never allowed to fail the write. See teams/README.md for the contract.
 */
server.post('/notify', async (request, response) => {
  const result = await handleNotify(request.body, request.header('x-notify-secret'), {
    references,
    secret: process.env.NOTIFY_SECRET,
    send: async (reference, what) => {
      const card =
        what.type === 'checkInReminder'
          ? checkInReminderCard(what.firstName ?? 'there')
          : ticketMovedCard(what)
      await adapter.continueConversationAsync(
        process.env.MICROSOFT_APP_ID ?? '',
        reference,
        async (context) => {
          await context.sendActivity(MessageFactory.attachment(CardFactory.adaptiveCard(card)))
        },
      )
    },
  })
  if (result.status !== 200) {
    console.warn('[HrGenieBot] notify refused', result.status, result.body)
  }
  response.status(result.status).json(result.body)
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
