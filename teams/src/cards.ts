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
  | { kind: 'describe'; subject?: string; category?: string }
  | { kind: 'cancel' }
  | { kind: 'myTickets' }
  | { kind: 'startTicket' }
  | { kind: 'holidays' }
  | { kind: 'team' }
  | { kind: 'ask'; question: string }

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
 * Where the card artwork is served from.
 *
 * This service, from `assets/icons`, on the same host as the tabs. It used to be the
 * HRBP console's GitHub Pages site, which meant a card could break because a different
 * repository deployed — and meant the two had to be released together to change a
 * glyph. A bot that ships its own artwork has neither problem.
 *
 * Adaptive Cards will only load an image over https, so `PUBLIC_BASE_URL` has to be a
 * real https host. Unset — the Emulator, `npm run try` — the URLs are relative and the
 * cards simply render without icons rather than failing.
 */
function iconBase(): string {
  // Read per call, not once at import: the host is configuration, and a module-level
  // constant would freeze whatever happened to be set when the file first loaded.
  return `${(process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '')}/icons`
}

/**
 * Cache-buster for the glyphs.
 *
 * Teams caches card images by URL and holds them for a long time, so replacing a PNG
 * at the same path leaves everyone looking at the old artwork — the file on disk is
 * new, the client just never asks for it again. Bumping this number changes the URL
 * and forces a refetch.
 *
 * Bump it whenever an icon is redrawn.
 */
const ICON_VERSION = 4

function iconUrl(name: string): string {
  return `${iconBase()}/${name}.png?v=${ICON_VERSION}`
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
 * [whiteFill].
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
function whiteFill() {
  // A function, not a constant: [iconUrl] reads the host from the environment, and a
  // module-level value would freeze whatever was set the moment this file loaded.
  return {
    backgroundImage: { url: iconUrl('tile-white'), fillMode: 'Cover' },
    roundedCorners: true,
  } as const
}

/**
 * Pinned dark, because [whiteFill] pins the background it sits on.
 *
 * An image does not follow the theme. Teams draws default text white in dark mode,
 * which on a pinned-white tile would be invisible. This is also why the white is
 * confined to the picker tiles and is not part of [TILE_SURFACE]: every other tiled
 * surface carries text this function does not own, and each would need the same
 * treatment to stay readable.
 */
const TILE_TEXT = { color: 'Dark' } as const

/**
 * A tap that leaves a trace in the conversation.
 *
 * A plain `Action.Submit` posts nothing. Teams shows a grey "Your response was sent to
 * the app" line most people never notice, so someone who taps a tile — especially one
 * several messages up, which stays tappable forever — sees no evidence anything
 * happened, and taps again. The reply, meanwhile, arrives at the bottom of a chat they
 * are not looking at.
 *
 * `messageBack` posts `displayText` as a message from them. That is the confirmation,
 * and it also scrolls the chat to the bottom, which is where the answer is.
 *
 * The action rides along twice on purpose: as the data itself, and JSON-encoded inside
 * `msteams.value`. Which of the two Teams delivers as `activity.value` depends on the
 * client, and [actionFrom] reads either.
 */
function submit(action: CardAction, label: string): Record<string, unknown> {
  return {
    ...action,
    msteams: {
      type: 'messageBack',
      displayText: label,
      // Also delivered as activity.text. If the value ever fails to arrive, the typed
      // shortcuts catch the common labels — a worse outcome than the card working, and
      // a much better one than silence.
      text: label,
      value: JSON.stringify(action),
    },
  }
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
/**
 * Enough to answer "what is next", not the whole year.
 *
 * The Holidays tab has the full calendar; a chat card that scrolls for a screen and a
 * half is answering a question nobody asked.
 */
const HOLIDAYS_IN_CHAT = 4

/** For the date chips. Short, because the chip is 40-odd pixels wide. */
const MONTHS_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]

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

  const next = shown[0]
  const daysTo = (isoDate: string): number =>
    Math.round(
      (Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000,
    )

  const away = daysTo(next.isoDate)
  const countdown = away <= 0 ? 'Today' : away === 1 ? 'Tomorrow' : `In ${away} days`
  const subtitle =
    away <= 0
      ? `${ahead.length} still ahead · the next one is today`
      : away === 1
        ? `${ahead.length} still ahead · the next one is tomorrow`
        : `${ahead.length} still ahead · next in ${away} days`

  /**
   * The date, as a chip.
   *
   * Every row needs something in its left column, and a coloured bar there is just
   * decoration that Adaptive Cards cannot draw thin enough to look deliberate — it
   * comes out as a pale block. A day and a month carry the same emphasis and are
   * worth reading, which is what the Holidays tab does with the same list.
   */
  const dateChip = (isoDate: string, isNext: boolean): unknown => ({
    type: 'Container',
    style: isNext ? 'accent' : 'emphasis',
    roundedCorners: true,
    spacing: 'None',
    minHeight: '54px',
    verticalContentAlignment: 'Center',
    items: [
      {
        type: 'TextBlock',
        text: String(Number(isoDate.slice(8, 10))),
        size: 'Large',
        weight: 'Bolder',
        horizontalAlignment: 'Center',
        spacing: 'None',
        wrap: false,
      },
      {
        type: 'TextBlock',
        text: MONTHS_SHORT[Number(isoDate.slice(5, 7)) - 1],
        size: 'Small',
        weight: 'Bolder',
        isSubtle: true,
        horizontalAlignment: 'Center',
        spacing: 'None',
        wrap: false,
      },
    ],
  })

  return card([
    header('Holidays', 'What is coming up', subtitle),
    body(
      shown.map((one) => {
        const isNext = one.isoDate === next.isoDate
        return {
          type: 'Container',
          ...TILE_SURFACE,
          spacing: 'Small',
          items: [
            {
              // Only the next one is filled. One marked row in a list of four reads at
              // a glance; two would make the mark mean nothing.
              type: 'Container',
              ...(isNext ? whiteFill() : {}),
              items: [
                {
                  type: 'ColumnSet',
                  columns: [
                    {
                      type: 'Column',
                      width: 'auto',
                      verticalContentAlignment: 'Center',
                      items: [dateChip(one.isoDate, isNext)],
                    },
                    {
                      type: 'Column',
                      width: 'stretch',
                      verticalContentAlignment: 'Center',
                      spacing: 'Medium',
                      items: [
                        {
                          type: 'TextBlock',
                          text: one.name,
                          weight: 'Bolder',
                          size: 'Medium',
                          wrap: true,
                          spacing: 'None',
                          ...(isNext ? TILE_TEXT : {}),
                        },
                        {
                          type: 'TextBlock',
                          text: `${weekday(one.isoDate)} · ${one.region}`,
                          size: 'Small',
                          isSubtle: true,
                          wrap: true,
                          spacing: 'None',
                          ...(isNext ? TILE_TEXT : {}),
                        },
                        ...(isNext
                          ? [
                              {
                                // Amber: a countdown is a "soon", not a status — the
                                // same reasoning as the Holidays tab.
                                type: 'TextBlock',
                                text: countdown,
                                size: 'Small',
                                weight: 'Bolder',
                                color: 'Warning',
                                wrap: false,
                                spacing: 'Small',
                              },
                            ]
                          : []),
                      ],
                    },
                    {
                      type: 'Column',
                      width: 'auto',
                      verticalContentAlignment: 'Center',
                      items: [
                        {
                          type: 'TextBlock',
                          text: one.kind === 'OPTIONAL' ? 'Optional' : 'Fixed',
                          size: 'Small',
                          weight: 'Bolder',
                          color: one.kind === 'OPTIONAL' ? 'Warning' : 'Good',
                          spacing: 'None',
                          wrap: false,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }
      }),
    ),
    {
      type: 'Container',
      spacing: 'Small',
      items: [
        {
          type: 'TextBlock',
          text: 'Fixed days are paid holidays everyone gets. Optional days you choose from the published list, and some are state-specific.',
          size: 'Small',
          isSubtle: true,
          wrap: true,
          spacing: 'None',
        },
      ],
    },
  ])
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
/**
 * A menu row: icon, a title with a line of explanation, and a chevron.
 *
 * Wider than the stacked tile it replaces, and it earns the width — someone opening
 * this for the first time does not know what "Pulse" is, and one line under the label
 * answers that without them having to tap and find out.
 *
 * The chevron is a text character. Adaptive Cards has no such affordance, and an image
 * for it would be a fourth network fetch to say "this is tappable".
 */
function menuRow(icon: string, title: string, description: string, data: CardAction): unknown {
  return {
    type: 'Container',
    ...TILE_SURFACE,
    selectAction: { type: 'Action.Submit', data: submit(data, title) },
    spacing: 'Small',
    items: [
      {
        type: 'Container',
        ...whiteFill(),
        items: [
          {
            type: 'ColumnSet',
            columns: [
              {
                type: 'Column',
                width: 'auto',
                verticalContentAlignment: 'Center',
                items: [
                  { type: 'Image', url: iconUrl(icon), width: '40px', height: '40px', altText: title },
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
                    text: title,
                    weight: 'Bolder',
                    size: 'Medium',
                    wrap: true,
                    spacing: 'None',
                    ...TILE_TEXT,
                  },
                  {
                    type: 'TextBlock',
                    text: description,
                    size: 'Small',
                    isSubtle: true,
                    wrap: true,
                    spacing: 'None',
                    ...TILE_TEXT,
                  },
                ],
              },
              {
                type: 'Column',
                width: 'auto',
                verticalContentAlignment: 'Center',
                items: [
                  { type: 'TextBlock', text: '›', size: 'Large', isSubtle: true, spacing: 'None', ...TILE_TEXT },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

/**
 * The questions people ask most, as one tap.
 *
 * Hard-coded until the backend can serve them from what is actually being asked.
 * They are the shortest path to the thing this bot is mainly for — answering a
 * question — and they teach that it answers questions at all, which a grid of tiles
 * does not.
 */
const POPULAR_QUESTIONS = [
  'How do I apply for leave?',
  'Where can I find payroll info?',
  'Who is my HRBP?',
  'How do I update my details?',
]

export function welcomeCard(firstName: string): AdaptiveCard {
  return card([
    /*
     * The header carries the mascot.
     *
     * A face in the corner is what makes this read as somebody's assistant rather than
     * a form. It sits in its own column so the greeting keeps its line length whatever
     * the name is.
     */
    {
      type: 'Container',
      bleed: true,
      spacing: 'None',
      backgroundImage: { url: iconUrl('header'), fillMode: 'Cover' },
      items: [
        {
          type: 'ColumnSet',
          columns: [
            {
              type: 'Column',
              width: 'stretch',
              verticalContentAlignment: 'Center',
              items: [
                {
                  type: 'TextBlock',
                  text: 'INFINITY LEARN',
                  size: 'Small',
                  weight: 'Bolder',
                  color: 'Light',
                  spacing: 'None',
                  wrap: true,
                },
                {
                  type: 'TextBlock',
                  text: `Hi ${firstName} 👋`,
                  size: 'ExtraLarge',
                  weight: 'Bolder',
                  color: 'Light',
                  wrap: true,
                  spacing: 'None',
                },
                {
                  type: 'TextBlock',
                  text: 'HR Genie · always on',
                  color: 'Light',
                  wrap: true,
                  spacing: 'Small',
                },
              ],
            },
            {
              type: 'Column',
              width: 'auto',
              verticalContentAlignment: 'Center',
              items: [
                {
                  type: 'Image',
                  url: iconUrl('mascot'),
                  width: '84px',
                  height: '84px',
                  altText: 'HR Genie',
                },
              ],
            },
          ],
        },
      ],
    },
    body([
      {
        type: 'ColumnSet',
        spacing: 'None',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            verticalContentAlignment: 'Center',
            items: [{ type: 'TextBlock', text: '💬', size: 'Medium', spacing: 'None' }],
          },
          {
            type: 'Column',
            width: 'stretch',
            verticalContentAlignment: 'Center',
            spacing: 'Small',
            items: [
              {
                type: 'TextBlock',
                text: 'Ask me about leave, insurance, payroll or policy — or pick one of these.',
                wrap: true,
                spacing: 'None',
              },
            ],
          },
        ],
      },
      menuRow('ticket', 'Raise a ticket', 'File a request or report an issue with HR', {
        kind: 'startTicket',
      }),
      menuRow('list', 'My tickets', 'View your tickets and responses', { kind: 'myTickets' }),
      // No pulse row. It is a once-a-month errand, and the nudge already asks for it
      // in the month it is open — a permanent tile for it competes with the things
      // people open this for. Typing "pulse" still works.
      // Reachable from chat, not only the tabs: tabs do not open on Teams mobile.
      menuRow('leave', 'Holidays', 'Check upcoming holidays and important dates', {
        kind: 'holidays',
      }),
      menuRow(
        'something-else',
        'Around the team',
        'See birthdays, work anniversaries and team milestones',
        { kind: 'team' },
      ),
      {
        type: 'TextBlock',
        text: '💡 Popular questions',
        size: 'Small',
        weight: 'Bolder',
        isSubtle: true,
        wrap: true,
        spacing: 'Medium',
      },
      {
        type: 'ActionSet',
        spacing: 'Small',
        actions: POPULAR_QUESTIONS.map((question) => ({
          type: 'Action.Submit',
          title: question,
          data: submit({ kind: 'ask', question }, question),
        })),
      },
      {
        type: 'TextBlock',
        text: '🔒 Your conversations are private and secure.',
        size: 'Small',
        isSubtle: true,
        horizontalAlignment: 'Center',
        wrap: true,
        spacing: 'Medium',
      },
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
 * What each category actually covers.
 *
 * "Payroll" and "Facilities" are clear to whoever wrote them and not to somebody
 * choosing under mild stress about their salary. A line of examples turns a guess into
 * a decision — and a ticket in the right queue is one HR does not have to move.
 *
 * Keyed by the names the API returns. A category added server-side gets no line rather
 * than a wrong one.
 */
const CATEGORY_HINT: Record<string, string> = {
  Payroll: 'Salary, payslips, reimbursements, tax and deductions',
  Leave: 'Leave balance, applications, comp-offs and holidays',
  'IT & access': 'Laptop, software, VPN, email and account access',
  Insurance: 'Health cover, claims, dependants and policy cards',
  Facilities: 'Office, seating, ID card, parking and workplace',
  'Something else': 'Anything that does not fit the others — HR will route it',
}

function hintFor(category: string): string {
  return CATEGORY_HINT[category] ?? ''
}

/**
 * The placeholder in the subject box.
 *
 * One line for every category, because a sent card cannot react to its own dropdown.
 * Adaptive Cards has no change event: nothing about a changed selection reaches the
 * bot until a button is pressed, so a per-category example goes stale the instant
 * somebody changes it — showing a payroll example under IT & access.
 */
const SUBJECT_PLACEHOLDER = 'Please describe your concern here'

export function subjectPromptCard(category: string, categories: string[] = []): AdaptiveCard {
  // The chosen one first, so the dropdown opens on it, and never twice if the server
  // already lists it.
  const choices = [category, ...categories.filter((one) => one !== category)]

  return card(
    [
      /*
       * No category in the header.
       *
       * It named the one that was picked, and then the dropdown below it could be
       * changed — leaving a card that said Payroll over a field that said Leave. A
       * sent card renders once, so the header cannot follow the dropdown; the only
       * honest fix is to stop it claiming to.
       */
      header('New ticket', 'What is happening?', 'Pick a category and tell us in a line or two.'),
      body([
        /*
         * The category, as a dropdown on this card.
         *
         * Changing it used to send you back to the picker — a second card, below the
         * one you were filling in, with whatever you had typed left behind on the
         * first. Since the subject already lives in a box here, the category can too,
         * and switching it costs nothing that was already written.
         */
        {
          type: 'TextBlock',
          text: 'Category',
          size: 'Small',
          weight: 'Bolder',
          isSubtle: true,
          wrap: true,
          spacing: 'Default',
        },
        {
          type: 'Input.ChoiceSet',
          id: 'category',
          value: category,
          style: 'compact',
          spacing: 'Small',
          choices: choices.map((one) => ({ title: one, value: one })),
        },
        {
          type: 'TextBlock',
          text: "Tell me what's happening in a line or two.",
          wrap: true,
          spacing: 'Medium',
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
          placeholder: SUBJECT_PLACEHOLDER,
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
    // One button. Both inputs ride along with it, so a changed category and a typed
    // subject arrive together — there is nothing to change the category *to* without
    // also saying what happened.
    [{ type: 'Action.Submit', title: 'Continue', style: 'positive', data: { kind: 'describe' } }],
  )
}

export function categoryCard(names: string[]): AdaptiveCard {
  return card([
    header('New ticket', 'What\'s it about?', 'Pick the closest — HR can move it later.'),
    // The same row the menu uses: a category is a choice, and a line of examples is
    // what makes it one rather than a guess.
    body(
      names.map((category) =>
        menuRow(iconFor(category), category, hintFor(category), {
          kind: 'pickCategory',
          category,
        }),
      ),
    ),
  ])
}

/**
 * The draft, before anything is written.
 *
 * Says plainly that nothing has been sent yet — an employee who assumes a ticket
 * exists will wait on HR instead of pressing the button.
 *
 * The category heads the card and what was typed sits in a box of its own. The
 * subject used to be the heading, which read as a title someone had chosen rather
 * than the words about to be sent to HR.
 */
export function draftCard(subject: string, category: string, raisedBy: string): AdaptiveCard {
  return card(
    [
      header('Ticket preview', category, 'Check it over — nothing has gone to HR yet.'),
      body([
        {
          type: 'TextBlock',
          text: 'YOUR CONCERN — EDIT IT IF YOU LIKE',
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
         * Adaptive Cards sends every input alongside the action. One less step, and no
         * chance of the card showing one thing while another is sent.
         */
        {
          type: 'Input.Text',
          id: 'subject',
          value: subject,
          isMultiline: true,
          spacing: 'Small',
          placeholder: SUBJECT_PLACEHOLDER,
        },
        /*
         * A meta line rather than a FactSet.
         *
         * A FactSet renders as a two-column table, which is a heavy way to say two
         * short things — and it repeated the category the header already carries. The
         * ticket list says the same kind of thing on one line; this matches it, so the
         * three cards of a ticket read as one flow.
         */
        {
          type: 'TextBlock',
          text: `Raised by ${raisedBy}`,
          size: 'Small',
          isSubtle: true,
          wrap: true,
          spacing: 'Medium',
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
      { type: 'Action.Submit', title: 'Cancel', data: submit({ kind: 'cancel' }, 'Cancel') },
    ],
  )
}

/**
 * What was filed, and what happens next.
 *
 * The reference is the thing to keep, so it is the heading and it is monospaced —
 * HRG-0012 gets read aloud and typed into a search box, and proportional digits make
 * that worse. The rest says plainly that nobody needs to check back.
 */
export function receiptCard(ticket: Ticket): AdaptiveCard {
  return card(
    [
      header('Ticket raised', ticket.id, `${ticket.category} · ${statusLabel(ticket.status)}`),
      body([
        {
          // Green on the one line reporting the outcome, rather than the whole header
          // — every card wears the same band, and success is the exception worth
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
              // The same white panel a ticket row uses, so the words that were filed
              // look the same here as they will in My tickets.
              type: 'Container',
              ...whiteFill(),
              items: [
                {
                  type: 'TextBlock',
                  text: ticket.subject,
                  size: 'Medium',
                  weight: 'Bolder',
                  wrap: true,
                  spacing: 'None',
                  ...TILE_TEXT,
                },
                {
                  // Reference, category and status on one line — the same three facts
                  // the ticket list carries, in the same order.
                  type: 'ColumnSet',
                  spacing: 'Small',
                  columns: [
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
                          spacing: 'None',
                          wrap: false,
                        },
                      ],
                    },
                    {
                      type: 'Column',
                      width: 'auto',
                      spacing: 'Small',
                      verticalContentAlignment: 'Center',
                      items: [
                        {
                          type: 'TextBlock',
                          text: ticket.id,
                          size: 'Small',
                          fontType: 'Monospace',
                          isSubtle: true,
                          spacing: 'None',
                          wrap: false,
                          ...TILE_TEXT,
                        },
                      ],
                    },
                    {
                      type: 'Column',
                      width: 'stretch',
                      spacing: 'Small',
                      verticalContentAlignment: 'Center',
                      items: [
                        {
                          type: 'TextBlock',
                          text: ticket.category,
                          size: 'Small',
                          isSubtle: true,
                          spacing: 'None',
                          wrap: false,
                          ...TILE_TEXT,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'TextBlock',
          text: "I'll message you here as soon as HR moves it — you do not need to check back.",
          wrap: true,
          size: 'Small',
          isSubtle: true,
          spacing: 'Default',
        },
      ]),
    ],
    [{ type: 'Action.Submit', title: 'My tickets', data: submit({ kind: 'myTickets' }, 'My tickets') }],
  )
}

/**
 * One named ticket, looked up by its reference.
 *
 * The same row the list uses, so a ticket looks the same however it was reached — and
 * the timeline behind its toggle comes along unchanged.
 */
export function oneTicketCard(ticket: Ticket): AdaptiveCard {
  return card([
    header('Ticket', ticket.id, `${ticket.category} · ${statusLabel(ticket.status)}`),
    body([ticketRow(ticket, 0)]),
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

/**
 * One of the employee's own tickets, laid out like the Android list.
 *
 * The status reads twice on purpose: a glyph on the left for scanning down the stack,
 * and the word on the meta line so nothing depends on colour alone — the same
 * reasoning as `item_my_ticket.xml`, and worth keeping because the two surfaces show
 * the same tickets to the same person.
 *
 * The reference is monospaced. `HRG-0012` is a thing people read out and type into a
 * search box, and proportional digits make that harder than it needs to be.
 */
function ticketRow(ticket: Ticket, index: number): unknown {
  const glyph =
    ticket.status === 'RESOLVED' ? '✓' : ticket.status === 'IN_PROGRESS' ? '⋯' : '!'

  return {
    type: 'Container',
    ...TILE_SURFACE,
    spacing: 'Default',
    items: [
      {
        type: 'Container',
        ...whiteFill(),
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
                    // A tinted disc with the status in it. Container styles are the
                    // only fill Adaptive Cards offers, and Teams draws the tint — so
                    // it follows light and dark without a second palette.
                    type: 'Container',
                    style: statusStyle(ticket.status),
                    roundedCorners: true,
                    minHeight: '38px',
                    verticalContentAlignment: 'Center',
                    spacing: 'None',
                    items: [
                      {
                        type: 'TextBlock',
                        text: glyph,
                        size: 'Medium',
                        weight: 'Bolder',
                        color: statusColour(ticket.status),
                        horizontalAlignment: 'Center',
                        spacing: 'None',
                        wrap: false,
                      },
                    ],
                  },
                ],
              },
              {
                type: 'Column',
                width: 'stretch',
                spacing: 'Medium',
                verticalContentAlignment: 'Center',
                items: [
                  {
                    type: 'TextBlock',
                    text: ticket.subject,
                    weight: 'Bolder',
                    size: 'Medium',
                    wrap: true,
                    maxLines: 2,
                    spacing: 'None',
                    ...TILE_TEXT,
                  },
                  {
                    // Status, reference and age on one line: three short facts that
                    // only mean anything together.
                    type: 'ColumnSet',
                    spacing: 'Small',
                    columns: [
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
                            spacing: 'None',
                            wrap: false,
                          },
                        ],
                      },
                      {
                        type: 'Column',
                        width: 'auto',
                        spacing: 'Small',
                        verticalContentAlignment: 'Center',
                        items: [
                          {
                            type: 'TextBlock',
                            text: ticket.id,
                            size: 'Small',
                            fontType: 'Monospace',
                            isSubtle: true,
                            spacing: 'None',
                            wrap: false,
                            ...TILE_TEXT,
                          },
                        ],
                      },
                      {
                        type: 'Column',
                        width: 'stretch',
                        spacing: 'Small',
                        verticalContentAlignment: 'Center',
                        items: [
                          {
                            type: 'TextBlock',
                            // Age rather than a date: "4 days ago" is what tells you
                            // whether HR is being slow.
                            text: `${ticket.category} · ${ago(ticket.createdAtMillis)}`,
                            size: 'Small',
                            isSubtle: true,
                            spacing: 'None',
                            wrap: false,
                            ...TILE_TEXT,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          // What HR wrote, folded away. Their reply is the point of the ticket, and
          // until this it was only visible on the update card as it arrived — scroll
          // past and it was gone. ToggleVisibility opens it in place, no round trip.
          ...replyBlock(ticket, index),
        ],
      },
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
    selectAction: { type: 'Action.Submit', data: submit({ kind: 'pickMood', mood }, MOOD_FACE[mood].label) },
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
      { type: 'Action.Submit', title: 'Just the face', data: submit({ kind: 'skipMoodDetail' }, 'Just the face') },
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
              data: submit({ kind: 'nudgeCheckIn' }, 'Check in'),
            },
          ]
        : []),
      ...(outstanding.pulse
        ? [
            {
              type: 'Action.Submit',
              title: 'Take the pulse',
              ...(outstanding.mood ? {} : { style: 'positive' }),
              data: submit({ kind: 'nudgePulse' }, 'Take the pulse'),
            },
          ]
        : []),
      { type: 'Action.Submit', title: 'Not today', data: submit({ kind: 'dismissNudge' }, 'Not today') },
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
    [{ type: 'Action.Submit', title: 'My tickets', data: submit({ kind: 'myTickets' }, 'My tickets') }],
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
    { type: 'Action.Submit', title: 'Raise a ticket instead', data: submit({ kind: 'startTicket' }, 'Raise a ticket') },
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
