/**
 * Drives the whole conversation from the command line.
 *
 * The point of this file: the flow can be proved end to end — against the real
 * backend — with no Teams, no Azure and no Microsoft account. What it cannot prove is
 * how the cards render, which is what the Emulator and a sideloaded app are for.
 *
 *     npm run build && npm run try
 */

import 'dotenv/config'
import { greet, handle, newState, type Input, type Reply } from '../conversation.js'

async function main(): Promise<void> {
  const state = newState()

  await show('· install ·', await greet())
  await step(state, { text: 'How many leaves do I have left?' }, 'types a question')
  await step(state, { action: { kind: 'startTicket' } }, 'presses Raise a ticket')
  await step(state, { action: { kind: 'pickCategory', category: 'Payroll' } }, 'picks Payroll')
  await step(state, { text: 'short' }, 'types too little')
  await step(state, { text: 'My July payslip is missing from the portal.' }, 'types the subject')

  // Two presses in a row: the second must do nothing. This is the duplicate-ticket
  // bug the Android app had, guarded here from the start.
  const first = handle(state, { action: { kind: 'raise' } })
  const second = handle(state, { action: { kind: 'raise' } })
  await show('presses Raise it', await first)
  const duplicate = await second
  console.log(
    duplicate.length === 0
      ? '\n  ✓ second press ignored while the first was in flight'
      : `\n  ✗ second press produced ${duplicate.length} replies — it would have filed a duplicate`,
  )

  await step(state, { action: { kind: 'myTickets' } }, 'presses My tickets')
}

async function step(
  state: Parameters<typeof handle>[0],
  input: Input,
  label: string,
): Promise<void> {
  await show(label, await handle(state, input))
}

async function show(label: string, replies: Reply[]): Promise<void> {
  console.log(`\n[36m▸ ${label}[0m`)
  for (const reply of replies) {
    if ('text' in reply) {
      console.log(`  ${reply.text}`)
    } else {
      console.log(`  [card] ${describe(reply.card)}`)
    }
  }
}

/** A one-line summary of a card, so the transcript stays readable. */
function describe(card: { body: unknown[]; actions?: unknown[] }): string {
  const texts = card.body
    .flatMap((item) => collectText(item))
    .filter(Boolean)
    .slice(0, 3)
  const actions = (card.actions ?? []).map(
    (action) => (action as { title?: string }).title ?? '?',
  )
  const shown = texts.join(' | ')
  return actions.length > 0 ? `${shown}   actions: [${actions.join(', ')}]` : shown
}

function collectText(item: unknown): string[] {
  const node = item as { type?: string; text?: string; items?: unknown[]; facts?: unknown[] }
  if (node.type === 'TextBlock' && node.text) return [node.text.replace(/\s+/g, ' ').slice(0, 70)]
  if (Array.isArray(node.items)) return node.items.flatMap(collectText)
  if (Array.isArray(node.facts)) {
    return node.facts.map((fact) => {
      const pair = fact as { title?: string; value?: string }
      return `${pair.title}: ${pair.value}`
    })
  }
  return []
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
