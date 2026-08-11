/**
 * Adaptive Cards for the ticket flow.
 *
 * These are the Teams equivalent of the chat cards in the Android app — the category
 * picker, the draft preview, the receipt, the ticket list. Card JSON only: nothing
 * here talks to Teams or to the backend, so the shapes can be checked in the Adaptive
 * Cards Designer or asserted in a test.
 *
 * On making these look like something: Adaptive Cards give you far less than CSS.
 * `ColumnSet` for grids and `Container.selectAction` to make a whole tile tappable —
 * rather than settling for full-width stock buttons — do most of the work here.
 *
 * A note for anyone who sees a card turn mustard in the Bot Framework Emulator: that
 * is the Emulator's **selection highlight**, not styling. Clicking a card selects it
 * so its JSON shows in the inspector, and the highlight follows the click. Rendering
 * the same JSON with the standard Adaptive Cards renderer shows it clean. Do not go
 * pulling styles out to chase it.
 *
 * Judge the result in Teams, not the Bot Framework Emulator: the Emulator renders
 * cards nearly unstyled, while Teams applies its own theme on top.
 */

import type { Ticket } from './api.js'

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json'
const VERSION = '1.5'

/** Every card action carries one of these, so the flow can tell them apart. */
export type CardAction =
  | { kind: 'pickCategory'; category: string }
  | { kind: 'raise' }
  | { kind: 'cancel' }
  | { kind: 'myTickets' }
  | { kind: 'startTicket' }

export interface AdaptiveCard {
  $schema: string
  type: 'AdaptiveCard'
  version: string
  body: unknown[]
  actions?: unknown[]
  msteams?: { width: 'Full' }
}

function card(body: unknown[], actions?: unknown[]): AdaptiveCard {
  return {
    $schema: SCHEMA,
    type: 'AdaptiveCard',
    version: VERSION,
    // Teams shrink-wraps cards to their content otherwise, which leaves a grid of
    // tiles squeezed into half the conversation width.
    msteams: { width: 'Full' },
    body,
    ...(actions ? { actions } : {}),
  }
}

/**
 * The tinted strip across the top of a card.
 *
 * `bleed` is what takes it edge to edge — without it the strip floats inside the
 * card's padding and reads as a box someone forgot to align.
 */
function header(eyebrow: string, title: string, subtitle?: string): unknown {
  return {
    type: 'Container',
    style: 'emphasis',
    bleed: true,
    spacing: 'None',
    items: [
      {
        type: 'TextBlock',
        text: eyebrow.toUpperCase(),
        size: 'Small',
        weight: 'Bolder',
        isSubtle: true,
        spacing: 'None',
        wrap: true,
      },
      { type: 'TextBlock', text: title, size: 'Large', weight: 'Bolder', wrap: true, spacing: 'None' },
      ...(subtitle
        ? [{ type: 'TextBlock', text: subtitle, wrap: true, isSubtle: true, spacing: 'Small' }]
        : []),
    ],
  }
}

/**
 * Everything below the heading.
 *
 * Note the absence of `style`. Setting it — even to `"default"` — makes the renderer
 * paint that style's background from its host config, and the Bot Framework Emulator's
 * default is a strong mustard. Omitting the property leaves the container transparent,
 * which is what "no styling" actually means here.
 */
function body(items: unknown[]): unknown {
  return { type: 'Container', spacing: 'None', items }
}

/**
 * Where the card artwork lives.
 *
 * Adaptive Cards will only load an image over https, so the glyphs ride along with
 * the HRBP console on GitHub Pages rather than needing a host of their own. The
 * domain has to be listed in the app manifest's `validDomains` too.
 */
const ICON_BASE = 'https://praveenreddy69.github.io/il-hr-genie/icons'

/**
 * A tappable tile: icon, label, and the whole thing is the button.
 *
 * `selectAction` is the trick. A stock `Action.Submit` renders as a full-width bar
 * with no room for an icon, and six of those is a wall — the same reason the Android
 * picker uses tiles rather than a list.
 */
function tile(icon: string, label: string, data: CardAction, caption?: string): unknown {
  return {
    type: 'Container',
    // No `style` — see [body]. A tile only needs to be tappable, not painted.
    selectAction: { type: 'Action.Submit', data },
    spacing: 'Small',
    items: [
      {
        type: 'ColumnSet',
        spacing: 'None',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            verticalContentAlignment: 'Center',
            items: [
              {
                type: 'Image',
                url: `${ICON_BASE}/${icon}.png`,
                width: '32px',
                height: '32px',
                altText: label,
                spacing: 'None',
              },
            ],
          },
          {
            type: 'Column',
            width: 'stretch',
            verticalContentAlignment: 'Center',
            items: [
              { type: 'TextBlock', text: label, weight: 'Bolder', wrap: true, spacing: 'None' },
              ...(caption
                ? [
                    {
                      type: 'TextBlock',
                      text: caption,
                      size: 'Small',
                      isSubtle: true,
                      wrap: true,
                      spacing: 'None',
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  }
}

/** Lays tiles out two to a row. */
function grid(tiles: unknown[]): unknown[] {
  const rows: unknown[] = []
  for (let index = 0; index < tiles.length; index += 2) {
    rows.push({
      type: 'ColumnSet',
      spacing: 'Small',
      columns: [tiles[index], tiles[index + 1]]
        .filter(Boolean)
        .map((item) => ({ type: 'Column', width: 'stretch', items: [item] })),
    })
  }
  return rows
}

export function welcomeCard(firstName: string): AdaptiveCard {
  return card([
    header('Infinity Learn', `Hi ${firstName} 👋`, 'HR Genie · always on'),
    {
      type: 'TextBlock',
      text:
        'Ask me about leave, insurance, payroll or policy — or raise a ticket and I\'ll file ' +
        'it with HR for you.',
      wrap: true,
      spacing: 'Medium',
    },
    ...grid([
      tile('ticket', 'Raise a ticket', { kind: 'startTicket' }, 'File something with HR'),
      tile('list', 'My tickets', { kind: 'myTickets' }, 'See what HR has done'),
    ]),
  ])
}

/**
 * The glyph each category carries, matching the Android picker.
 *
 * A category the server adds later falls back to the catch-all rather than showing a
 * broken image — the names come from the API, not from here.
 */
const CATEGORY_ICON: Record<string, string> = {
  Payroll: 'payroll',
  Leave: 'leave',
  'IT & access': 'it-access',
  Insurance: 'insurance',
  Facilities: 'facilities',
  'Something else': 'something-else',
}

function iconFor(category: string): string {
  return CATEGORY_ICON[category] ?? 'something-else'
}

/** An icon beside a line of text, for the places a full tile would be too much. */
function withIcon(category: string, text: string): unknown {
  return {
    type: 'ColumnSet',
    spacing: 'None',
    columns: [
      {
        type: 'Column',
        width: 'auto',
        verticalContentAlignment: 'Center',
        items: [
          {
            type: 'Image',
            url: `${ICON_BASE}/${iconFor(category)}.png`,
            width: '24px',
            height: '24px',
            altText: category,
            spacing: 'None',
          },
        ],
      },
      {
        type: 'Column',
        width: 'stretch',
        verticalContentAlignment: 'Center',
        items: [{ type: 'TextBlock', text, wrap: true, spacing: 'None' }],
      },
    ],
  }
}

export function categoryCard(names: string[]): AdaptiveCard {
  return card([
    header('New ticket', 'What\'s it about?', 'Pick the closest — HR can move it later.'),
    ...grid(
      names.map((category) =>
        tile(iconFor(category), category, { kind: 'pickCategory', category }),
      ),
    ),
  ])
}

/**
 * The draft, before anything is written.
 *
 * Says plainly that nothing has been sent yet — an employee who assumes a ticket
 * exists will wait on HR instead of pressing the button.
 */
export function draftCard(subject: string, category: string, raisedBy: string): AdaptiveCard {
  return card(
    [
      header('Ticket preview', subject),
      body([
        { ...(withIcon(category, `**${category}**`) as object), spacing: 'Medium' },
        {
          type: 'FactSet',
          spacing: 'Small',
          facts: [{ title: 'Raised by', value: raisedBy }],
        },
        {
          type: 'Container',
          style: 'warning',
          spacing: 'Medium',
          items: [
            {
              type: 'TextBlock',
              text: '**Nothing has gone to HR yet.** Choose Raise it and it goes straight over.',
              wrap: true,
              size: 'Small',
            },
          ],
        },
      ]),
    ],
    [
      { type: 'Action.Submit', title: 'Raise it', style: 'positive', data: { kind: 'raise' } },
      { type: 'Action.Submit', title: 'Cancel', data: { kind: 'cancel' } },
    ],
  )
}

export function receiptCard(ticket: Ticket): AdaptiveCard {
  return card([
    {
      type: 'Container',
      style: 'good',
      bleed: true,
      spacing: 'None',
      items: [
        {
          type: 'TextBlock',
          text: `✅ Raised as ${ticket.id}`,
          size: 'Large',
          weight: 'Bolder',
          wrap: true,
          spacing: 'None',
        },
      ],
    },
    body([
      { type: 'TextBlock', text: ticket.subject, wrap: true, spacing: 'Medium' },
      {
        type: 'FactSet',
        facts: [
          { title: 'Category', value: ticket.category },
          { title: 'Status', value: statusLabel(ticket.status) },
        ],
      },
      {
        type: 'TextBlock',
        text: 'Your HRBP sees it on their dashboard straight away.',
        wrap: true,
        isSubtle: true,
        size: 'Small',
      },
    ]),
  ])
}

export function ticketsCard(tickets: Ticket[]): AdaptiveCard {
  if (tickets.length === 0) {
    return card([
      header('My tickets', 'Nothing with HR right now'),
      body([
        {
          type: 'TextBlock',
          text: 'When you raise a ticket it will show here, with whatever HR has done to it.',
          wrap: true,
          isSubtle: true,
          spacing: 'Medium',
        },
      ]),
    ])
  }

  const open = tickets.filter((ticket) => ticket.status !== 'RESOLVED').length
  return card([
    header(
      'My tickets',
      `${tickets.length} with HR`,
      `${open} still open · newest first`,
    ),
    body(tickets.slice(0, 10).map((ticket) => ({
      type: 'ColumnSet',
      separator: true,
      spacing: 'Small',
      columns: [
        {
          type: 'Column',
          width: 'auto',
          verticalContentAlignment: 'Center',
          items: [
            {
              type: 'Image',
              url: `${ICON_BASE}/${iconFor(ticket.category)}.png`,
              width: '28px',
              height: '28px',
              altText: ticket.category,
              spacing: 'None',
            },
          ],
        },
        {
          type: 'Column',
          width: 'stretch',
          items: [
            { type: 'TextBlock', text: ticket.subject, wrap: true, weight: 'Bolder', spacing: 'None' },
            {
              type: 'TextBlock',
              text: `${ticket.id} · ${ticket.category}`,
              wrap: true,
              isSubtle: true,
              size: 'Small',
              spacing: 'None',
            },
          ],
        },
        {
          type: 'Column',
          width: 'auto',
          verticalContentAlignment: 'Center',
          items: [
            {
              type: 'TextBlock',
              text: statusLabel(ticket.status),
              size: 'Small',
              weight: 'Bolder',
              color: statusColour(ticket.status),
              wrap: false,
              spacing: 'None',
            },
          ],
        },
      ],
    }))),
  ])
}

/**
 * A knowledge-base answer.
 *
 * The source is named when the service gives one. An answer with no source is shown
 * as itself and never dressed up as policy — the Android app makes the same
 * distinction, and it is the difference between quoting HR and guessing.
 */
export function answerCard(text: string, source: string | null): AdaptiveCard {
  const body: unknown[] = [{ type: 'TextBlock', text, wrap: true }]
  if (source) {
    body.push({
      type: 'Container',
      style: 'accent',
      spacing: 'Medium',
      items: [
        {
          type: 'TextBlock',
          text: `📄 From ${source}`,
          wrap: true,
          size: 'Small',
          weight: 'Bolder',
          spacing: 'None',
        },
      ],
    })
  }
  return card(body, [
    { type: 'Action.Submit', title: 'Raise a ticket instead', data: { kind: 'startTicket' } },
  ])
}

function statusLabel(status: Ticket['status']): string {
  switch (status) {
    case 'OPEN':
      return 'Open'
    case 'IN_PROGRESS':
      return 'In progress'
    case 'RESOLVED':
      return 'Resolved'
  }
}

/** Status is the one place colour carries meaning, so it is the only place it is used. */
function statusColour(status: Ticket['status']): string {
  switch (status) {
    case 'OPEN':
      return 'Warning'
    case 'IN_PROGRESS':
      return 'Accent'
    case 'RESOLVED':
      return 'Good'
  }
}
