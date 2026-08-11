/**
 * A chat window for a browser, for developing the cards.
 *
 * The Bot Framework Emulator renders Adaptive Cards through its own host config and
 * paints a selection highlight over whichever card you clicked, which makes it a poor
 * place to judge a design. This serves the same conversation through the standard
 * Adaptive Cards renderer — the one Teams' own is built from — so what you see is
 * close to what Teams will show.
 *
 * **Development only.** It has no authentication and every visitor shares one
 * conversation per id they pick. It is mounted alongside the real bot endpoint purely
 * so both can be exercised from one process; it must not be exposed anywhere public.
 */

import { handle, greet, newState, type ConversationState, type Reply } from './conversation.js'
import type { CardAction } from './cards.js'

const conversations = new Map<string, ConversationState>()

export interface DevTurn {
  conversationId: string
  text?: string
  action?: CardAction
  /** Set on the first request, to get the greeting rather than an answer. */
  greeting?: boolean
}

export async function devTurn(turn: DevTurn): Promise<Reply[]> {
  if (turn.greeting) {
    conversations.set(turn.conversationId, newState())
    return greet()
  }

  let state = conversations.get(turn.conversationId)
  if (!state) {
    state = newState()
    conversations.set(turn.conversationId, state)
  }
  return handle(state, { text: turn.text, action: turn.action })
}

/**
 * The page itself.
 *
 * Inlined rather than served from a file so the harness stays one module — it is a
 * development aid, and a second directory of assets to keep in step is not worth it.
 */
export const DEV_CHAT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HR Genie — card preview</title>
<script src="https://unpkg.com/adaptivecards@3.0.4/dist/adaptivecards.min.js"></script>
<script src="https://unpkg.com/markdown-it@13.0.2/dist/markdown-it.min.js"></script>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 14px/1.5 "Segoe UI", system-ui, sans-serif;
    background: #f5f5f5; color: #242424; height: 100vh;
    display: grid; grid-template-rows: auto 1fr auto;
  }
  header {
    padding: 12px 20px; background: #fff; border-bottom: 1px solid #e0e0e0;
    display: flex; align-items: center; gap: 12px;
  }
  header strong { font-size: 15px; }
  header span { color: #616161; font-size: 12px; }
  header button {
    margin-left: auto; font: inherit; padding: 6px 12px; border-radius: 4px;
    border: 1px solid #d1d1d1; background: #fff; cursor: pointer;
  }
  #log { overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .row { display: flex; }
  .row.me { justify-content: flex-end; }
  .bubble {
    max-width: 70%; padding: 10px 14px; border-radius: 8px;
    background: #fff; border: 1px solid #e0e0e0; white-space: pre-wrap;
  }
  .row.me .bubble { background: #5b5fc7; color: #fff; border-color: #5b5fc7; }
  .card { max-width: 70%; background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.13); }
  footer { padding: 12px 20px; background: #fff; border-top: 1px solid #e0e0e0; display: flex; gap: 8px; }
  footer input { flex: 1; font: inherit; padding: 10px 12px; border: 1px solid #d1d1d1; border-radius: 4px; }
  footer button {
    font: inherit; padding: 10px 18px; border: 0; border-radius: 4px;
    background: #5b5fc7; color: #fff; cursor: pointer;
  }
  .note { color: #616161; font-size: 12px; text-align: center; padding: 4px; }
</style>
</head>
<body>
<header>
  <strong>HR Genie</strong>
  <span>card preview · standard Adaptive Cards renderer</span>
  <button id="restart">Restart</button>
</header>
<div id="log"></div>
<footer>
  <input id="input" placeholder="Ask about leave, claims, policy…" autocomplete="off">
  <button id="send">Send</button>
</footer>
<script>
  const log = document.getElementById('log')
  const input = document.getElementById('input')
  const conversationId = 'dev-' + Math.random().toString(36).slice(2)

  // Without this the renderer warns and shows **bold** markers verbatim.
  const md = window.markdownit()
  AdaptiveCards.AdaptiveCard.onProcessMarkdown = (text, result) => {
    result.outputHtml = md.render(text)
    result.didProcess = true
  }

  const hostConfig = new AdaptiveCards.HostConfig({
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    containerStyles: {
      default: { backgroundColor: '#FFFFFF', foregroundColors: { default: { default: '#242424', subtle: '#616161' } } },
      emphasis: { backgroundColor: '#F0F0F0', foregroundColors: { default: { default: '#242424', subtle: '#616161' } } },
      good: { backgroundColor: '#E7F5EC', foregroundColors: { default: { default: '#0F5132', subtle: '#3B7A57' } } },
      warning: { backgroundColor: '#FDF3E7', foregroundColors: { default: { default: '#7A4B12', subtle: '#9A6B32' } } },
      attention: { backgroundColor: '#FDE7E9', foregroundColors: { default: { default: '#8A1F2B', subtle: '#A85560' } } },
      accent: { backgroundColor: '#EBF3FF', foregroundColors: { default: { default: '#1A4C8B', subtle: '#4A6E9E' } } },
    },
  })

  function say(text, mine) {
    const row = document.createElement('div')
    row.className = 'row' + (mine ? ' me' : '')
    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    bubble.textContent = text
    row.appendChild(bubble)
    log.appendChild(row)
    log.scrollTop = log.scrollHeight
  }

  function show(json) {
    const card = new AdaptiveCards.AdaptiveCard()
    card.hostConfig = hostConfig
    card.onExecuteAction = (action) => {
      if (action instanceof AdaptiveCards.SubmitAction) send({ action: action.data })
    }
    card.parse(json)
    const row = document.createElement('div')
    row.className = 'row'
    const host = document.createElement('div')
    host.className = 'card'
    host.appendChild(card.render())
    row.appendChild(host)
    log.appendChild(row)
    log.scrollTop = log.scrollHeight
  }

  async function send(turn) {
    if (turn.text) say(turn.text, true)
    const response = await fetch('/dev/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, ...turn }),
    })
    const replies = await response.json()
    for (const reply of replies) {
      if (reply.text !== undefined) say(reply.text, false)
      else show(reply.card)
    }
  }

  document.getElementById('send').onclick = () => {
    const text = input.value.trim()
    if (!text) return
    input.value = ''
    send({ text })
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('send').click()
  })
  document.getElementById('restart').onclick = () => location.reload()

  send({ greeting: true })
</script>
</body>
</html>`
