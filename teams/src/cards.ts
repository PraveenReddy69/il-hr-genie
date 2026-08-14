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

import {
  type Celebrant,
  MOOD_REASONS,
  type Celebrations,
  type Mood,
  type MoodCheckIn,
  type PulseQuestion,
  type Ticket,
} from './api.js'
import type { Holiday } from './holidays.js'

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json'
const VERSION = '1.5'

/** Every card action carries one of these, so the flow can tell them apart. */
export type CardAction =
  | { kind: 'pickCategory'; category: string }
  | { kind: 'checkIn' }
  | { kind: 'pickMood'; mood: Mood }
  | { kind: 'saveMood'; reasons?: string; note?: string }
  | { kind: 'skipMoodDetail' }
  | { kind: 'startPulse' }
  | { kind: 'savePulse'; [answer: string]: string }
  | { kind: 'dismissNudge' }
  // The nudge's own buttons. Same errands as `checkIn` and `startPulse`, but a
  // distinct kind so the nudge can be retired when one is pressed without taking
  // the welcome menu — which fires the plain kinds — down with it.
  | { kind: 'nudgeCheckIn' }
  | { kind: 'nudgePulse' }
  | { kind: 'raise'; subject?: string }
  | { kind: 'describe'; subject?: string }
  | { kind: 'cancel' }
  | { kind: 'myTickets' }
  | { kind: 'startTicket' }
  | { kind: 'holidays' }
  | { kind: 'team' }

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
 * The branded band across the top of a card.
 *
 * `backgroundImage` is the only way to get a gradient — Adaptive Cards has no gradient
 * of its own — and `bleed` is what takes it edge to edge. Without bleed the band
 * floats inside the card's padding and reads as a box someone forgot to align.
 *
 * All three lines are `Light` and none are `isSubtle`: subtle renders white text at
 * partial opacity, which on a gradient is illegible rather than quiet. Hierarchy comes
 * from size and weight instead.
 */
function header(eyebrow: string, title: string, subtitle?: string): unknown {
  return {
    type: 'Container',
    bleed: true,
    spacing: 'None',
    backgroundImage: { url: iconUrl('header'), fillMode: 'Cover' },
    items: [
      {
        type: 'TextBlock',
        text: eyebrow.toUpperCase(),
        size: 'Small',
        weight: 'Bolder',
        color: 'Light',
        spacing: 'None',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: title,
        size: 'Large',
        weight: 'Bolder',
        color: 'Light',
        wrap: true,
        spacing: 'None',
      },
      ...(subtitle
        ? [
            {
              type: 'TextBlock',
              text: subtitle,
              wrap: true,
              color: 'Light',
              spacing: 'Small',
            },
          ]
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
  return { type: 'Container', spacing: 'Default', items }
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
 * Cache-buster for the glyphs.
 *
 * Teams caches card images by URL and holds them for a long time, so replacing a PNG
 * at the same path leaves everyone looking at the old artwork — the file on Pages is
 * new, the client just never asks for it again. Bumping this number changes the URL
 * and forces a refetch.
 *
 * Bump it whenever an icon is redrawn.
 */
const ICON_VERSION = 3

function iconUrl(name: string): string {
  return `${ICON_BASE}/${name}.png?v=${ICON_VERSION}`
}

/**
 * The surface a tile sits on.
 *
 * `style` only — no background image. A remote PNG behind every tile means the whole
 * picker looks unstyled whenever the image is slow, blocked or cached badly, which is
 * exactly what happened on mobile: the tiles read as plain text on white. A style is
 * drawn by the Teams client itself, so it cannot fail to load and it follows the
 * user's light or dark theme for free.
 *
 * A white tile outlined and rounded, rather than the grey `emphasis` block. Checked
 * against all seven backgrounds in the real client: `showBorder` and `roundedCorners`
 * are honoured, and the outline separates tiles as well as a fill does without the
 * weight. The tinted styles were rejected on meaning, not looks — `good`, `warning`
 * and `attention` say success, caution and error in Teams, so a permanent amber tile
 * reads as a permanent problem.
 *
 * Used by every tiled surface. For true white rather than the client's grey, see
 * [WHITE_TILE].
 */
const TILE_SURFACE = { style: 'default', showBorder: true, roundedCorners: true } as const

/**
 * The white fill for a picker tile.
 *
 * There is no white container style — `default` inherits the card surface, and the
 * Teams client draws that as a light grey. An image is the only way to fix the fill.
 * It earns its keep here because the failure mode is mild: if it does not load the
 * tile keeps its border and rounded corners and merely falls back to the grey, rather
 * than collapsing to unstyled text the way the old image-backed tiles did on mobile.
 *
 * This goes on a container *inside* the bordered one rather than on the bordered one
 * itself. Checked in the real client against four other arrangements: a background
 * image paints over the stroke `showBorder` draws, so a tile that asks for both on
 * the same container gets the fill and loses the outline. Nesting keeps them off each
 * other's edges.
 */
const WHITE_FILL = {
  backgroundImage: { url: `${ICON_BASE}/tile-white.png?v=${ICON_VERSION}`, fillMode: 'Cover' },
  roundedCorners: true,
} as const

/**
 * Pinned dark, because [WHITE_FILL] pins the background it sits on.
 *
 * An image does not follow the theme. Teams draws default text white in dark mode,
 * which on a pinned-white tile would be invisible. This is also why the white is
 * confined to the picker tiles and is not part of [TILE_SURFACE]: every other tiled
 * surface carries text this function does not own, and each would need the same
 * treatment to stay readable.
 */
const TILE_TEXT = { color: 'Dark' } as const

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
    ...TILE_SURFACE,
    // The stroke is drawn out here and the white filled inside, because one container
    // cannot do both — see [WHITE_FILL]. `selectAction` stays on the outer one so the
    // whole tile, border included, is the button.
    selectAction: { type: 'Action.Submit', data },
    spacing: 'Default',
    items: [
      {
        type: 'Container',
        ...WHITE_FILL,
        items: [
          // Stacked and centred, two to a row. A horizontal version was tried against
          // a design mockup and looked worse: the polish in that mockup comes from
          // gradients, shadows and soft washes, and Adaptive Cards has none of them —
          // what survives is a wide grey box with a stray pill in it.
          {
            type: 'Image',
            url: iconUrl(icon),
            width: '40px',
            height: '40px',
            altText: label,
            horizontalAlignment: 'Center',
            spacing: 'Small',
          },
          {
            type: 'TextBlock',
            text: label,
            size: 'Medium',
            weight: 'Bolder',
            wrap: true,
            horizontalAlignment: 'Center',
            spacing: 'Small',
            ...TILE_TEXT,
          },
          ...(caption
            ? [
                {
                  type: 'TextBlock',
                  text: caption,
                  size: 'Small',
                  isSubtle: true,
                  wrap: true,
                  horizontalAlignment: 'Center',
                  spacing: 'None',
                  ...TILE_TEXT,
                },
              ]
            : []),
        ],
      },
    ],
  }
}

/**
 * A tappable row: icon beside the label, full width.
 *
 * The list form, for the category picker. Six stacked tiles read as a wall of equal
 * options to weigh up; six rows read as a list to scan down, which is what choosing a
 * category actually is. The grid earns its place on the welcome card, where the tiles
 * are destinations rather than a single choice — and where the captions under each
 * label need the room.
 */
function listTile(icon: string, label: string, data: CardAction): unknown {
  return {
    type: 'Container',
    ...TILE_SURFACE,
    selectAction: { type: 'Action.Submit', data },
    spacing: 'Small',
    items: [
      {
        type: 'Container',
        ...WHITE_FILL,
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'auto',
                verticalContentAlignment: 'Center',
                items: [
                  {
                    type: 'Image',
                    url: iconUrl(icon),
                    width: '32px',
                    height: '32px',
                    altText: label,
                  },
                ],
              },
              {
                type: 'Column',
                width: 'stretch',
                verticalContentAlignment: 'Center',
                spacing: 'Medium',
                items: [
                  {
                    type: 'TextBlock',
                    text: label,
                    weight: 'Bolder',
                    wrap: true,
                    spacing: 'None',
                    ...TILE_TEXT,
                  },
                ],
              },
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
    const pair = [tiles[index], tiles[index + 1]]
    rows.push({
      type: 'ColumnSet',
      spacing: 'Default',
      // An odd tile keeps its half of the row rather than stretching across it. The
      // menu loses a tile whenever something is already done for the day, and a lone
      // double-width card in the last row reads as a different kind of thing.
      columns: pair.map((item) => ({
        type: 'Column',
        width: 'stretch',
        items: item ? [item] : [],
      })),
    })
  }
  return rows
}

/**
 * The holiday calendar, in chat.
 *
 * Chat works on every client; tabs do not. Anything an employee genuinely needs has
 * to be reachable here, with the tab as the roomier view for people at a desk.
 *
 * Only what is still ahead, and only a handful — a list of dates that have already
 * passed is a reference document, not an answer.
 */
export function holidaysCard(holidays: Holiday[], todayIso: string): AdaptiveCard {
  const ahead = holidays.filter((one) => one.isoDate >= todayIso)
  const shown = ahead.slice(0, HOLIDAYS_IN_CHAT)

  if (shown.length === 0) {
    return card([
      header('Holidays', 'Nothing left this year'),
      body([
        {
          type: 'TextBlock',
          text: 'No more published dates for this year. The Holidays tab has the full calendar.',
          wrap: true,
          isSubtle: true,
          spacing: 'Default',
        },
      ]),
    ])
  }

  return card([
    header('Holidays', 'What is coming up', `${ahead.length} still ahead this year`),
    body(
      shown.map((one) => ({
        type: 'Container',
        ...TILE_SURFACE,
        spacing: 'Small',
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'stretch',
                items: [
                  { type: 'TextBlock', text: one.name, weight: 'Bolder', wrap: true, spacing: 'None' },
                  {
                    type: 'TextBlock',
                    text: `${prettyDate(one.isoDate)} · ${weekday(one.isoDate)} · ${one.region}`,
                    size: 'Small',
                    isSubtle: true,
                    wrap: true,
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
                    type: 'Container',
                    style: one.kind === 'OPTIONAL' ? 'warning' : 'good',
                    spacing: 'None',
                    items: [
                      {
                        type: 'TextBlock',
                        text: one.kind === 'OPTIONAL' ? 'Optional' : 'Fixed',
                        size: 'Small',
                        weight: 'Bolder',
                        color: one.kind === 'OPTIONAL' ? 'Warning' : 'Good',
                        wrap: false,
                        spacing: 'None',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })).concat([
        {
          type: 'TextBlock',
          text: 'Fixed days are paid holidays everyone gets. Optional days you choose from the published list, and some are state-specific.',
          wrap: true,
          size: 'Small',
          isSubtle: true,
          spacing: 'Default',
        },
      ] as never),
    ),
  ])
}

/** Enough to answer "what is next", not the whole year. */
const HOLIDAYS_IN_CHAT = 4

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function prettyDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`
}

function weekday(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })
}

/**
 * The answer to "hi".
 *
 * Small, and deliberately not the menu. Six tiles every time somebody types "ok" is
 * noise, and it teaches nothing — whereas one card naming the word that opens the
 * menu is a thing a person can remember and use tomorrow.
 */
export function helloCard(): AdaptiveCard {
  return card([
    header('Infinity Learn', "Hello! I'm HR Genie 👋", 'Here whenever you need HR'),
    body([
      {
        type: 'TextBlock',
        text: "You can always start our conversation by typing **genie** or **help**.",
        wrap: true,
        spacing: 'Default',
      },
      {
        type: 'TextBlock',
        text: 'Or just ask me a question — leave, insurance, payroll, policy.',
        wrap: true,
        size: 'Small',
        isSubtle: true,
        spacing: 'Small',
      },
    ]),
  ])
}

/**
 * The menu.
 *
 * No check-in tile, deliberately. A check-in is once a day, so the tile could only
 * ever be live when today was unanswered — which is precisely when the nudge above
 * is already asking for it. Two buttons for one errand on one screen, and pressing
 * the second did nothing, because the first had already opened the card.
 *
 * Check in is still reachable: the nudge, and typing "check in".
 */
export function welcomeCard(firstName: string): AdaptiveCard {
  const tiles = [
    tile('ticket', 'Raise a ticket', { kind: 'startTicket' }, 'File with HR'),
    tile('list', 'My tickets', { kind: 'myTickets' }, 'See replies'),
    tile('pulse', 'Monthly pulse', { kind: 'startPulse' }, 'Four quick questions'),
    // Reachable from chat, not only the tabs: tabs do not open on Teams mobile.
    tile('leave', 'Holidays', { kind: 'holidays' }, 'What is coming up'),
    tile('something-else', 'Around the team', { kind: 'team' }, 'Birthdays and milestones'),
  ]

  return card([
    header('Infinity Learn', `Hi ${firstName} 👋`, 'HR Genie · always on'),
    body([
      {
        type: 'TextBlock',
        text: 'Ask me about leave, insurance, payroll or policy — or pick one of these.',
        wrap: true,
        spacing: 'Default',
      },
      ...grid(tiles),
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

/**
 * What was picked, and what to do next.
 *
 * The picker itself is retired once a category is chosen, because a card cannot be
 * restyled after submit — six tiles that all still look identical are no record of
 * anything. This replaces it and names the choice, so scrolling back shows the
 * decision rather than the menu.
 */
export function subjectPromptCard(category: string): AdaptiveCard {
  return card(
    [
      header('New ticket', category, 'Category chosen — HR can move it later.'),
      body([
        {
          type: 'TextBlock',
          text: "Tell me what's happening in a line or two.",
          wrap: true,
          spacing: 'Default',
        },
        // A box, not an instruction to type into the chat. The line above used to be
        // the whole card, which left people looking at a message that asked for
        // something with nowhere obvious to put it — and anything they did type went
        // through the same path as "hi", where a stray word became the subject. A
        // field makes the ask and the answer the same object.
        {
          type: 'Input.Text',
          id: 'subject',
          isMultiline: true,
          placeholder: 'e.g. My March payslip is missing the shift allowance',
          spacing: 'Small',
        },
        {
          type: 'TextBlock',
          text: 'Nothing goes to HR until you have seen it and chosen Raise it.',
          wrap: true,
          size: 'Small',
          isSubtle: true,
          spacing: 'Small',
        },
      ]),
    ],
    [
      // First, and styled: it is what the card is for. Change category is the escape
      // hatch — the alternative being to scroll back to a picker that may be several
      // messages up, or worse, an older one from a previous attempt.
      { type: 'Action.Submit', title: 'Continue', style: 'positive', data: { kind: 'describe' } },
      { type: 'Action.Submit', title: 'Change category', data: { kind: 'startTicket' } },
    ],
  )
}

export function categoryCard(names: string[]): AdaptiveCard {
  return card([
    header('New ticket', 'What\'s it about?', 'Pick the closest — HR can move it later.'),
    body(
      names.map((category) =>
        listTile(iconFor(category), category, { kind: 'pickCategory', category }),
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
      /*
       * The category heads the card, and what was typed sits in a panel of its own.
       *
       * The subject used to be the heading, which read as a title someone had chosen
       * rather than the words about to be sent to HR — and it left the category as an
       * afterthought below. This way the band says what kind of thing this is, and the
       * message is presented as the quotable thing it is, under a label saying so.
       *
       * It also matches the card the category picker leaves behind, so the two steps
       * read as one flow rather than two designs.
       */
      header('Ticket preview', category, 'Check it over — nothing has gone to HR yet.'),
      body([
        {
          type: 'TextBlock',
          text: 'WHAT YOU TOLD ME — EDIT IT IF YOU LIKE',
          size: 'Small',
          weight: 'Bolder',
          isSubtle: true,
          wrap: true,
          spacing: 'Default',
        },
        /*
         * Editable in place, rather than a read-only panel plus an Edit button.
         *
         * Whatever is in this box when Raise it is pressed is what gets filed —
         * Adaptive Cards sends every input alongside the action. One less step, and
         * no chance of the card showing one thing while another is sent.
         */
        {
          type: 'Input.Text',
          id: 'subject',
          value: subject,
          isMultiline: true,
          spacing: 'Small',
          placeholder: 'What is happening?',
        },
        {
          type: 'FactSet',
          spacing: 'Default',
          facts: [
            { title: 'Category', value: category },
            { title: 'Raised by', value: raisedBy },
          ],
        },
        {
          type: 'TextBlock',
          text: 'Choose Raise it and it goes straight to your HRBP. Cancel drops it.',
          wrap: true,
          size: 'Small',
          isSubtle: true,
          spacing: 'Small',
        },
      ]),
    ],
    [
      { type: 'Action.Submit', title: 'Raise it', style: 'positive', data: { kind: 'raise' } },
      { type: 'Action.Submit', title: 'Cancel', data: { kind: 'cancel' } },
    ],
  )
}

/**
 * The receipt.
 *
 * Deliberately the same shape as the draft it replaces — reference in the band, the
 * words in their own panel under a label, facts beneath — so raising a ticket reads
 * as one card confirming rather than a second card starting over.
 *
 * It also answers the question people actually have at this moment, which is not
 * "did it save" but "what happens now". Hence the closing line and a way to track it.
 */
export function receiptCard(ticket: Ticket): AdaptiveCard {
  return card(
    [
      header('Ticket raised', ticket.id, `${ticket.category} · ${statusLabel(ticket.status)}`),
      body([
        {
          // Green for the one line reporting the outcome rather than the whole header
          // — every card wears the same band now, and success is the exception worth
          // colouring.
          type: 'Container',
          style: 'good',
          spacing: 'Default',
          items: [
            {
              type: 'TextBlock',
              text: '✅ Filed with HR',
              weight: 'Bolder',
              wrap: true,
              spacing: 'None',
            },
          ],
        },
        {
          type: 'TextBlock',
          text: 'WHAT HR RECEIVED',
          size: 'Small',
          weight: 'Bolder',
          isSubtle: true,
          wrap: true,
          spacing: 'Default',
        },
        {
          type: 'Container',
          ...TILE_SURFACE,
          spacing: 'Small',
          items: [
            {
              type: 'TextBlock',
              text: ticket.subject,
              size: 'Medium',
              weight: 'Bolder',
              wrap: true,
              spacing: 'None',
            },
          ],
        },
        {
          type: 'FactSet',
          spacing: 'Default',
          facts: [
            { title: 'Reference', value: ticket.id },
            { title: 'Category', value: ticket.category },
            { title: 'Status', value: statusLabel(ticket.status) },
          ],
        },
        {
          type: 'TextBlock',
          text: "I'll message you here as soon as HR moves it — you do not need to check back.",
          wrap: true,
          size: 'Small',
          isSubtle: true,
          spacing: 'Small',
        },
      ]),
    ],
    [{ type: 'Action.Submit', title: 'My tickets', data: { kind: 'myTickets' } }],
  )
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
          spacing: 'Default',
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
    body([
      ...tickets.slice(0, TICKETS_IN_CHAT).map((ticket, index) => ticketRow(ticket, index)),
      /*
       * The rest expand here, in the card.
       *
       * This used to say "open the My tickets tab" — which is a dead end on Teams
       * mobile, where personal tabs do not open. Chat renders on every client, so
       * anything an employee needs has to be reachable from it.
       */
      ...(tickets.length > TICKETS_IN_CHAT
        ? (() => {
            const hidden = tickets.slice(TICKETS_IN_CHAT, 10)
            const ids = hidden.map((_, offset) => `older-${TICKETS_IN_CHAT + offset}`)
            const both = [...ids, 'older-more', 'older-less']
            const button = (id: string, title: string, visible: boolean) => ({
              type: 'ActionSet',
              id,
              spacing: 'Small',
              ...(visible ? {} : { isVisible: false }),
              actions: [{ type: 'Action.ToggleVisibility', title, targetElements: both }],
            })
            return [
              ...hidden.map((ticket, offset) => ({
                ...(ticketRow(ticket, TICKETS_IN_CHAT + offset) as object),
                id: ids[offset],
                isVisible: false,
              })),
              button('older-more', `Show ${hidden.length} older`, true),
              button('older-less', 'Show fewer', false),
            ]
          })()
        : []),
    ]),
  ])
}

/** The badge tint behind a status. `good` for done, `warning` for waiting. */
function statusStyle(status: Ticket['status']): string {
  return status === 'RESOLVED' ? 'good' : status === 'IN_PROGRESS' ? 'accent' : 'warning'
}

/** "today", "4 days ago" — how long this has been sitting with HR. */
function ago(millis: number): string {
  const days = Math.floor((Date.now() - millis) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  return months === 1 ? 'a month ago' : `${months} months ago`
}

/** One ticket in the list. Shared by the visible rows and the folded-away ones. */
function ticketRow(ticket: Ticket, index: number): unknown {
  // A tile each, like the Android list. Separators alone leave ten tickets reading
  // as one block of text.
  return {
        type: 'Container',
        ...TILE_SURFACE,
        spacing: 'Default',
        items: [
          {
            type: 'ColumnSet',
            columns: [
        {
          type: 'Column',
          width: 'auto',
          verticalContentAlignment: 'Center',
          items: [
            {
              type: 'Image',
              url: iconUrl(iconFor(ticket.category)),
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
              // Age matters more than the raw date in a list: "4 days ago" is the
              // thing that tells you whether HR is being slow.
              text: `${ticket.id} · ${ticket.category} · ${ago(ticket.createdAtMillis)}`,
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
                    // A tinted badge rather than a coloured word. Container styles are
                    // the only fill Adaptive Cards offers, and the tint is drawn by
                    // Teams — so it follows light and dark without a second palette.
                    type: 'Container',
                    style: statusStyle(ticket.status),
                    spacing: 'None',
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
              },
            ],
          },
          // What HR wrote, folded away. Their reply is the point of the ticket, and
          // until now it was only visible on the update card as it arrived — scroll
          // past and it was gone. ToggleVisibility opens it in place, no round trip.
          ...replyBlock(ticket, index),
        ],
  }
}

/** How many fit in a chat card before it stops being readable. */
const TICKETS_IN_CHAT = 3

/**
 * A ticket's journey, hidden behind a toggle.
 *
 * Three stops, each with the moment it happened: raised, picked up, resolved. The
 * timestamps are real — `createdAtMillis` for the first, and every status change
 * carries its own time in the comment thread.
 *
 * Adaptive Cards cannot draw the connecting line between the dots; there are no
 * shapes and no SVG. Coloured markers, aligned labels and consistent spacing carry
 * the same reading — a sequence with a state each — which is what the line was for.
 *
 * Only where there is something to show: an OPEN ticket nobody has touched has no
 * journey yet, and a button promising one would be a lie.
 */
function replyBlock(ticket: Ticket, index: number): unknown[] {
  const comments = [...(ticket.comments ?? [])].sort((a, b) => a.atMillis - b.atMillis)
  /*
   * A comment's time where there is one; otherwise `updatedAtMillis` for the stop the
   * ticket is sitting on right now.
   *
   * HR can move a ticket without commenting for every status but RESOLVED, and that
   * move has only one timestamp — so it dates the current stop and nothing earlier.
   */
  const at = (status: string) => {
    const commented = comments.find((one) => one.status === status)?.atMillis
    if (commented) return commented
    return status === ticket.status ? ticket.updatedAtMillis : undefined
  }
  const stops: { label: string; millis?: number; colour: string; reached: boolean }[] = [
    { label: 'Raised', millis: ticket.createdAtMillis, colour: 'Warning', reached: true },
    {
      label: 'Picked up by HR',
      millis: at('IN_PROGRESS'),
      colour: 'Warning',
      reached: ticket.status !== 'OPEN',
    },
    {
      label: 'Resolved',
      millis: at('RESOLVED'),
      colour: 'Good',
      reached: ticket.status === 'RESOLVED',
    },
  ]

  const latest = [...comments].reverse().find((one) => one.text?.trim())
  if (!latest && ticket.status === 'OPEN') return []

  const id = `reply-${index}`
  return [
    {
      type: 'ActionSet',
      spacing: 'Small',
      actions: [
        {
          type: 'Action.ToggleVisibility',
          title: `Track this ticket · ${statusLabel(ticket.status)}`,
          targetElements: [id],
        },
      ],
    },
    {
      type: 'Container',
      id,
      isVisible: false,
      spacing: 'Small',
      items: [
        ...stops.map((stop) => ({
          type: 'ColumnSet',
          spacing: 'Small',
          columns: [
            {
              type: 'Column',
              width: 'auto',
              verticalContentAlignment: 'Center',
              items: [
                {
                  // A filled marker for what has happened, hollow for what has not —
                  // the same distinction the ring in the design carries.
                  type: 'TextBlock',
                  text: stop.reached ? '◉' : '○',
                  size: 'Medium',
                  color: stop.reached ? stop.colour : 'Default',
                  isSubtle: !stop.reached,
                  spacing: 'None',
                },
              ],
            },
            {
              type: 'Column',
              width: 'stretch',
              items: [
                {
                  type: 'TextBlock',
                  text: stop.label,
                  weight: 'Bolder',
                  wrap: true,
                  isSubtle: !stop.reached,
                  spacing: 'None',
                },
                {
                  type: 'TextBlock',
                  // Reached but untimed is a different thing from not reached: HR can
                  // resolve a ticket without commenting at the in-progress stage, and
                  // "Not yet" under a filled marker contradicts itself.
                  text: stop.millis
                    ? stamp(stop.millis)
                    : stop.reached
                      ? 'No comment recorded'
                      : 'Not yet',
                  size: 'Small',
                  isSubtle: true,
                  wrap: true,
                  spacing: 'None',
                },
              ],
            },
          ],
        })),
        ...(latest
          ? [
              {
                type: 'TextBlock',
                text: 'WHAT HR SAID',
                size: 'Small',
                weight: 'Bolder',
                isSubtle: true,
                wrap: true,
                spacing: 'Default',
              },
              {
                type: 'Container',
                ...TILE_SURFACE,
                spacing: 'Small',
                items: [
                  { type: 'TextBlock', text: latest.text, wrap: true, spacing: 'None' },
                  {
                    type: 'TextBlock',
                    text: `${employeeLabel(latest.authorId)} · ${stamp(latest.atMillis)}`,
                    size: 'Small',
                    isSubtle: true,
                    wrap: true,
                    spacing: 'Small',
                  },
                ],
              },
            ]
          : []),
      ],
    },
  ]
}

/** "12 May 2025 · 09:15 AM" — the format the Android app uses. */
function stamp(millis: number): string {
  const when = new Date(millis)
  const date = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  return `${date} · ${time}`
}

/** HR authors show as HR; anything else is the id, which is better than nothing. */
function employeeLabel(authorId: string): string {
  return /^HR/i.test(authorId) ? 'HR' : authorId
}

/**
 * The five faces, best to worst.
 *
 * Emoji rather than drawn glyphs: a face is the one thing every platform already
 * renders well, and the Android check-in uses the same five. Anything hand-drawn at
 * 32px would read as a worse version of what the reader already knows.
 */
const MOOD_FACE: Record<Mood, { face: string; label: string }> = {
  GREAT: { face: '😄', label: 'Great' },
  GOOD: { face: '🙂', label: 'Good' },
  OKAY: { face: '😐', label: 'Okay' },
  STRESSED: { face: '😟', label: 'Stressed' },
  BURNT_OUT: { face: '😩', label: 'Burnt out' },
}

export function moodLabel(mood: Mood): string {
  return MOOD_FACE[mood].label
}

/**
 * The check-in itself.
 *
 * Says what HR sees before anything is picked, not after. Someone deciding whether to
 * answer honestly needs that before they answer, not on the confirmation.
 */
export function moodCard(existing: MoodCheckIn | null): AdaptiveCard {
  return card([
    header(
      'Check-in',
      'How are you today?',
      existing
        ? `You said ${MOOD_FACE[existing.mood].label.toLowerCase()} earlier — pick again to change it.`
        : 'Your HRBP sees the check-in as part of a team trend. Your note stays with you.',
    ),
    body([
      ...faceRow(),
    ]),
  ])
}

/**
 * The five faces. Shared by the check-in and the reminder.
 *
 * Stacked rather than a row of five. Five columns across a phone is about 55px each,
 * which shredded the labels one character at a time — "Stressed" came out as
 * "St / res / se / d". A full-width row per mood reads at any width, and the tap
 * target is the whole row rather than a thumbnail.
 *
 * The face and the label sit in one TextBlock: two columns reintroduces the width
 * problem at the small end, and an emoji that fails to render leaves the word intact
 * this way rather than an empty box.
 */
function faceRow(): unknown[] {
  return (Object.keys(MOOD_FACE) as Mood[]).map((mood) => ({
    type: 'Container',
    ...TILE_SURFACE,
    spacing: 'Small',
    selectAction: { type: 'Action.Submit', data: { kind: 'pickMood', mood } },
    items: [
      {
        type: 'TextBlock',
        text: `${MOOD_FACE[mood].face}  ${MOOD_FACE[mood].label}`,
        size: 'Medium',
        weight: 'Bolder',
        wrap: true,
        spacing: 'None',
      },
    ],
  }))
}

/**
 * The check-in, arriving unasked.
 *
 * Carries the faces rather than a button that opens them: this interrupts someone, so
 * it should cost one tap to answer, not two. The line about what HR sees is here for
 * the same reason it is on the check-in — somebody deciding whether to answer
 * honestly needs it before they answer, and a pushed card may be the first thing they
 * have ever seen from this bot.
 */
export function checkInReminderCard(firstName: string): AdaptiveCard {
  return card([
    header('Check-in', `How are you today, ${firstName}?`, 'One tap. Your note stays with you.'),
    body([
      ...faceRow(),
      {
        type: 'TextBlock',
        text: 'Your HRBP sees the check-in as part of a team trend. Your manager never sees it.',
        wrap: true,
        isSubtle: true,
        size: 'Small',
        spacing: 'Default',
      },
    ]),
  ])
}

/**
 * Reasons and a note, both optional.
 *
 * One card rather than two more steps: the check-in is meant to take seconds, and
 * every extra card is another chance to abandon it. Save works with nothing filled in.
 */
export function moodDetailCard(mood: Mood): AdaptiveCard {
  return card(
    [
      header('Check-in', `${MOOD_FACE[mood].face} ${MOOD_FACE[mood].label}`, 'Anything behind it?'),
      body([
        {
          type: 'Container',
          ...TILE_SURFACE,
          spacing: 'Default',
          items: [
            { type: 'TextBlock', text: 'What is behind it?', weight: 'Bolder', wrap: true, spacing: 'None' },
            {
              type: 'Input.ChoiceSet',
              id: 'reasons',
              isMultiSelect: true,
              style: 'expanded',
              spacing: 'Small',
              choices: MOOD_REASONS.map((reason) => ({ title: reason, value: reason })),
            },
          ],
        },
        {
          type: 'Input.Text',
          id: 'note',
          isMultiline: true,
          placeholder: 'Anything you want to add? Only you will see this.',
          spacing: 'Default',
        },
        {
          type: 'TextBlock',
          text: 'HR sees the face, never the note.',
          size: 'Small',
          isSubtle: true,
          wrap: true,
          spacing: 'Small',
        },
      ]),
    ],
    [
      { type: 'Action.Submit', title: 'Save', style: 'positive', data: { kind: 'saveMood' } },
      { type: 'Action.Submit', title: 'Just the face', data: { kind: 'skipMoodDetail' } },
    ],
  )
}

export function moodDoneCard(mood: Mood, reasons: string[], note: string | null): AdaptiveCard {
  return card([
    header('Checked in', `${MOOD_FACE[mood].face} ${MOOD_FACE[mood].label}`, 'Thanks — that helps.'),
    body([
      ...(reasons.length > 0
        ? [{ type: 'TextBlock', text: reasons.join(' · '), wrap: true, spacing: 'Default' }]
        : []),
      {
        type: 'TextBlock',
        text: note
          ? 'Your note is saved and stays with you.'
          : 'You can check in again any time — the latest answer replaces the last.',
        wrap: true,
        isSubtle: true,
        size: 'Small',
        spacing: 'Small',
      },
    ]),
  ])
}

/**
 * The nudge that opens a conversation when something is outstanding.
 *
 * Modelled on how the other employee-experience bots in the tenant do it: say what is
 * being asked, say who sees it, and give one button. What is deliberately *not*
 * copied is the pressure — no "waiting to hear from you", no chasing. One ask, and
 * **Not today** dismisses it without argument. A wellbeing prompt that nags is one
 * people answer to make it stop, which is worse than no data.
 */
export function nudgeCard(
  firstName: string,
  outstanding: { mood: boolean; pulse: boolean },
): AdaptiveCard | null {
  if (!outstanding.mood && !outstanding.pulse) return null

  const both = outstanding.mood && outstanding.pulse
  const title = outstanding.mood ? `Hi ${firstName} — how are you today?` : `Hi ${firstName} 👋`
  const line = both
    ? `Two things open: today’s check-in, and this month’s pulse. Neither takes long.`
    : outstanding.mood
      ? `You haven’t checked in today. It takes ten seconds, and the check-in is the only thing your HRBP sees from you.`
      : `This month’s pulse is still open — four questions, and answers roll up to a department average.`

  return card(
    [
      header('HR Genie', title, 'Infinity Learn'),
      body([
        { type: 'TextBlock', text: line, wrap: true, spacing: 'Default' },
        {
          type: 'TextBlock',
          text: 'Your HRBP sees trends, never your note. Your manager never sees any of it.',
          wrap: true,
          isSubtle: true,
          size: 'Small',
          spacing: 'Small',
        },
      ]),
    ],
    [
      ...(outstanding.mood
        ? [
            {
              type: 'Action.Submit',
              title: 'Check in',
              style: 'positive',
              data: { kind: 'nudgeCheckIn' },
            },
          ]
        : []),
      ...(outstanding.pulse
        ? [
            {
              type: 'Action.Submit',
              title: 'Take the pulse',
              ...(outstanding.mood ? {} : { style: 'positive' }),
              data: { kind: 'nudgePulse' },
            },
          ]
        : []),
      { type: 'Action.Submit', title: 'Not today', data: { kind: 'dismissNudge' } },
    ],
  )
}

/**
 * All four pulse questions on one card.
 *
 * One card, not four: the monthly pulse is already the longer of the two asks, and a
 * four-step wizard is where people give up. Every question can be left blank — the
 * server takes a partial answer, and a partial pulse beats an abandoned one.
 */
export function pulseCard(questions: PulseQuestion[]): AdaptiveCard {
  return card(
    [
      header('Monthly pulse', 'Four questions', 'Answers roll up to a department average.'),
      body(
        // One block per question, so four questions read as four things to answer
        // rather than one long column of radio buttons.
        questions.map((question) => ({
          type: 'Container',
          ...TILE_SURFACE,
          spacing: 'Default',
          items: [
            { type: 'TextBlock', text: question.text, wrap: true, weight: 'Bolder', spacing: 'None' },
            ...(question.hint
              ? [
                  {
                    type: 'TextBlock',
                    text: question.hint,
                    wrap: true,
                    isSubtle: true,
                    size: 'Small',
                    spacing: 'None',
                  },
                ]
              : []),
            {
              type: 'Input.ChoiceSet',
              id: question.id,
              style: 'expanded',
              spacing: 'Small',
              choices: question.options.map((option) => ({ title: option, value: option })),
            },
          ],
        })),
      ),
    ],
    [{ type: 'Action.Submit', title: 'Send', style: 'positive', data: { kind: 'savePulse' } }],
  )
}

export function pulseDoneCard(answered: number, total: number): AdaptiveCard {
  return card([
    header('Pulse sent', 'Thanks — that helps', `${answered} of ${total} answered`),
    body([
      {
        type: 'TextBlock',
        text:
          `It goes into this month’s department averages. Nothing here is attributed to ` +
          `you by name.`,
        wrap: true,
        isSubtle: true,
        size: 'Small',
        spacing: 'Default',
      },
    ]),
  ])
}

/**
 * What HR has done since the employee last looked.
 *
 * Leads with HR's own words rather than the status word. "Resolved" tells someone
 * nothing; "Deduction reversed in the August run" is the thing they raised the ticket
 * to find out, and it is why this card exists at all — the bot cannot push a
 * notification, so this is where the answer reaches them.
 */
export function updatesCard(tickets: Ticket[]): AdaptiveCard {
  const one = tickets.length === 1
  return card([
    header(
      'While you were away',
      one ? 'HR moved your ticket' : `HR moved ${tickets.length} of your tickets`,
      one ? undefined : 'Newest first',
    ),
    body(
      tickets.map((ticket) => {
        // The comment attached to the move that was made, not the oldest one.
        const latest = [...ticket.comments].sort((a, b) => b.atMillis - a.atMillis)[0]
        return {
          type: 'Container',
          ...TILE_SURFACE,
          spacing: 'Default',
          items: [
            {
              type: 'ColumnSet',
              columns: [
                {
                  type: 'Column',
                  width: 'stretch',
                  items: [
                    {
                      type: 'TextBlock',
                      text: ticket.subject,
                      wrap: true,
                      weight: 'Bolder',
                      spacing: 'None',
                    },
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
            },
            ...(latest?.text
              ? [
                  {
                    type: 'TextBlock',
                    text: `“${latest.text}”`,
                    wrap: true,
                    spacing: 'Small',
                  },
                ]
              : []),
          ],
        }
      }),
    ),
  ])
}

/**
 * One ticket moving, pushed into the chat unprompted.
 *
 * Separate from [updatesCard] because the situations differ: that one catches someone
 * up on what they missed, this one interrupts them. So it leads with HR's words and
 * offers the list, rather than reciting several tickets they did not ask about.
 */
export function ticketMovedCard(moved: {
  ticketId: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
  comment?: string
  subject?: string
  category?: string
}): AdaptiveCard {
  const headline =
    moved.status === 'RESOLVED'
      ? `HR closed ${moved.ticketId}`
      : moved.status === 'IN_PROGRESS'
        ? `HR picked up ${moved.ticketId}`
        : `${moved.ticketId} is back with HR`

  return card(
    [
      header('Ticket update', headline, moved.subject),
      body([
        ...(moved.comment
          ? [
              {
                type: 'Container',
                ...TILE_SURFACE,
                spacing: 'Default',
                items: [
                  { type: 'TextBlock', text: `“${moved.comment}”`, wrap: true, spacing: 'None' },
                ],
              },
            ]
          : []),
        {
          type: 'TextBlock',
          text: `${moved.category ? `${moved.category} · ` : ''}${statusLabel(moved.status)}`,
          size: 'Small',
          weight: 'Bolder',
          color: statusColour(moved.status),
          wrap: true,
          spacing: 'Default',
        },
      ]),
    ],
    [{ type: 'Action.Submit', title: 'My tickets', data: { kind: 'myTickets' } }],
  )
}

/**
 * Birthdays, anniversaries and new joiners.
 *
 * Returns null when there is nothing today rather than a card saying so — an empty
 * "nobody is celebrating" card is noise every single day it is not someone's birthday.
 */
/**
 * How many of each group are named before the card gets summarised.
 *
 * Ten birthdays run as one comma-separated paragraph is a wall nobody reads, and it
 * is also unkind — a name in the middle of a run of eleven has not really been
 * mentioned. Three each, then a count.
 */
const CELEBRANTS_SHOWN = 3

/**
 * Today, around the team.
 *
 * Three labelled sections rather than one list, with a row per person carrying their
 * id and job title — the console shows the same, and two colleagues who share a first
 * name are otherwise indistinguishable. Adaptive Cards has no tabs, so the sections
 * stack.
 */
export function celebrationsCard(celebrations: Celebrations): AdaptiveCard | null {
  const sections: unknown[] = []

  const add = (
    key: string,
    emoji: string,
    label: string,
    people: Celebrant[],
    detail: (one: Celebrant) => string,
    greeting: (one: Celebrant) => string,
  ) => {
    if (people.length === 0) return

    /**
     * "Wish" — opens a Teams chat with that person, message already typed.
     *
     * A deep link, not a message the bot sends. A bot cannot post as someone else,
     * and it should not: a birthday wish that the recipient can see was written by a
     * machine on a colleague's behalf is worse than no wish. This puts the words in
     * the box and leaves the send to a human.
     *
     * It also needs no permission and no install on the recipient's side, which the
     * alternative — the bot messaging them directly — would.
     */
    const wish = (one: Celebrant): unknown[] => {
      if (!one.email) return []
      const link =
        'https://teams.microsoft.com/l/chat/0/0' +
        `?users=${encodeURIComponent(one.email)}` +
        `&message=${encodeURIComponent(greeting(one))}`
      return [
        {
          type: 'ActionSet',
          spacing: 'None',
          horizontalAlignment: 'Right',
          actions: [{ type: 'Action.OpenUrl', title: 'Wish', url: link }],
        },
      ]
    }

    /** One person, as their own surface — a row you can pick out at a glance. */
    const row = (one: Celebrant, index: number): unknown => ({
      type: 'Container',
      ...TILE_SURFACE,
      spacing: 'Small',
      // Only the overflow carries an id; ToggleVisibility needs one to target.
      ...(index < CELEBRANTS_SHOWN ? {} : { id: `${key}-${index}`, isVisible: false }),
      items: [
        {
          type: 'ColumnSet',
          spacing: 'None',
          columns: [
            {
              type: 'Column',
              width: 'auto',
              verticalContentAlignment: 'Center',
              items: [{ type: 'TextBlock', text: emoji, size: 'Large', spacing: 'None' }],
            },
            {
              type: 'Column',
              width: 'stretch',
              items: [
                { type: 'TextBlock', text: one.name, weight: 'Bolder', wrap: true, spacing: 'None' },
                {
                  type: 'TextBlock',
                  text: detail(one),
                  size: 'Small',
                  isSubtle: true,
                  wrap: true,
                  spacing: 'None',
                },
              ],
            },
            // The action sits at the end of the row, not under the name: it belongs
            // to the person beside it, and stacked under two lines of text it read as
            // a footer for the whole section.
            ...(one.email
              ? [
                  {
                    type: 'Column',
                    width: 'auto',
                    verticalContentAlignment: 'Center',
                    items: wish(one),
                  },
                ]
              : []),
          ],
        },
      ],
    })

    const hidden = people.length - CELEBRANTS_SHOWN
    sections.push({
      type: 'Container',
      spacing: 'Default',
      items: [
        {
          type: 'TextBlock',
          text: label.toUpperCase(),
          size: 'Small',
          weight: 'Bolder',
          isSubtle: true,
          wrap: true,
          spacing: 'None',
        },
        ...people.map(row),
        /*
         * Expand and collapse, in place, with no round trip to us.
         *
         * An action cannot rewrite its own title, so "+7 more" would still say "+7
         * more" once everything was already showing. Two buttons instead — one
         * visible, one not — and every toggle flips the rows *and* both buttons, so
         * they swap. Which is the only way to get a label that tells the truth.
         */
        ...(hidden > 0
          ? (() => {
              const rows = people
                .slice(CELEBRANTS_SHOWN)
                .map((_, offset) => `${key}-${CELEBRANTS_SHOWN + offset}`)
              const both = [...rows, `${key}-more`, `${key}-less`]
              const button = (id: string, title: string, visible: boolean) => ({
                type: 'ActionSet',
                id,
                spacing: 'Small',
                ...(visible ? {} : { isVisible: false }),
                actions: [{ type: 'Action.ToggleVisibility', title, targetElements: both }],
              })
              return [
                button(`${key}-more`, `+${hidden} more`, true),
                button(`${key}-less`, 'Show less', false),
              ]
            })()
          : []),
      ],
    })
  }

  /** People are wished by first name; the directory holds the full one. */
  const firstNameOf = (one: Celebrant): string => one.name.split(' ')[0] || one.name

  /** Id and title, skipping either if the directory has not got it. */
  const who = (one: Celebrant): string =>
    [one.employeeId, one.designation].filter(Boolean).join(' · ') || 'Infinity Learn'

  add('bday', '🎂', 'Birthdays', celebrations.birthdays, who, (one) =>
    `Happy birthday, ${firstNameOf(one)}! 🎂`,
  )
  add(
    'anniv',
    '🎉',
    'Work anniversaries',
    celebrations.anniversaries,
    (one) =>
      [one.years ? `${one.years} ${one.years === 1 ? 'year' : 'years'}` : '', who(one)]
        .filter(Boolean)
        .join(' · '),
    (one) =>
      one.years
        ? `Congratulations on ${one.years} ${one.years === 1 ? 'year' : 'years'} at Infinity Learn, ${firstNameOf(one)}! 🎉`
        : `Congratulations on your work anniversary, ${firstNameOf(one)}! 🎉`,
  )
  add('joiner', '👋', 'New joiners', celebrations.newJoiners, who, (one) =>
    `Welcome to Infinity Learn, ${firstNameOf(one)}! 👋`,
  )

  if (sections.length === 0) return null
  return card([header('Around the team', 'Today at Infinity Learn'), body(sections)])
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
      spacing: 'Default',
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

/**
 * A status a person can only read as a state.
 *
 * "Open" was being read as a verb — the badge looked like a button that would open
 * the ticket. "With HR" says who is holding it, which is the thing the reader
 * actually wants to know.
 */
function statusLabel(status: Ticket['status']): string {
  switch (status) {
    case 'OPEN':
      return 'With HR'
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
