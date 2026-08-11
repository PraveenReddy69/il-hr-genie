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
  MOOD_REASONS,
  type Celebrations,
  type Mood,
  type MoodCheckIn,
  type PulseQuestion,
  type Ticket,
} from './api.js'

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
    backgroundImage: { url: `${ICON_BASE}/header.png`, fillMode: 'Cover' },
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
 * What every tile sits on.
 *
 * `style: 'emphasis'` is kept for the padding Teams gives a styled container — there
 * is no padding property in this schema version — and the image paints over its grey
 * with the app's own wash. Colour and breathing room, neither of which the style
 * alone provides.
 */
const TILE_SURFACE = {
  style: 'emphasis',
  backgroundImage: { url: `${ICON_BASE}/tile.png`, fillMode: 'Cover' },
} as const

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
    selectAction: { type: 'Action.Submit', data },
    spacing: 'Default',
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
      spacing: 'Default',
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
    body([
      {
        type: 'TextBlock',
        text: 'Ask me about leave, insurance, payroll or policy — or pick one of these.',
        wrap: true,
        spacing: 'Default',
      },
      ...grid([
        tile('ticket', 'Raise a ticket', { kind: 'startTicket' }, 'File with HR'),
        tile('list', 'My tickets', { kind: 'myTickets' }, 'See replies'),
      ]),
      ...grid([
        tile('mood', 'Check in', { kind: 'checkIn' }, 'Ten seconds'),
        tile('pulse', 'Monthly pulse', { kind: 'startPulse' }, 'Four questions'),
      ]),
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
        { ...(withIcon(category, `**${category}**`) as object), spacing: 'Default' },
        {
          type: 'FactSet',
          spacing: 'Small',
          facts: [{ title: 'Raised by', value: raisedBy }],
        },
        {
          type: 'Container',
          style: 'warning',
          spacing: 'Default',
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
    header('Ticket raised', ticket.id, 'Your HRBP sees it straight away.'),
    body([
      {
        // Green is kept for the one line reporting the outcome rather than the whole
        // header — every card wears the same band now, and success is the exception
        // worth colouring.
        type: 'Container',
        style: 'good',
        spacing: 'Default',
        items: [
          { type: 'TextBlock', text: '✅ Filed with HR', weight: 'Bolder', wrap: true, spacing: 'None' },
        ],
      },
      { type: 'TextBlock', text: ticket.subject, wrap: true, spacing: 'Default' },
      {
        type: 'FactSet',
        facts: [
          { title: 'Category', value: ticket.category },
          { title: 'Status', value: statusLabel(ticket.status) },
        ],
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
    body(
      tickets.slice(0, 10).map((ticket) => ({
        // A tile each, like the Android list. Separators alone leave ten tickets
        // reading as one block of text.
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
          },
        ],
      })),
    ),
  ])
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
      {
        type: 'ColumnSet',
        spacing: 'Default',
        columns: (Object.keys(MOOD_FACE) as Mood[]).map((mood) => ({
          type: 'Column',
          width: 'stretch',
          items: [
            {
              // A surface each, so five faces read as five buttons rather than a row
              // of emoji with words under them.
              type: 'Container',
              ...TILE_SURFACE,
              selectAction: { type: 'Action.Submit', data: { kind: 'pickMood', mood } },
              items: [
                {
                  type: 'TextBlock',
                  text: MOOD_FACE[mood].face,
                  size: 'ExtraLarge',
                  horizontalAlignment: 'Center',
                  spacing: 'None',
                },
                {
                  type: 'TextBlock',
                  text: MOOD_FACE[mood].label,
                  size: 'Small',
                  weight: 'Bolder',
                  wrap: true,
                  horizontalAlignment: 'Center',
                  spacing: 'None',
                },
              ],
            },
          ],
        })),
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
        ? [{ type: 'Action.Submit', title: 'Check in', style: 'positive', data: { kind: 'checkIn' } }]
        : []),
      ...(outstanding.pulse
        ? [
            {
              type: 'Action.Submit',
              title: 'Take the pulse',
              ...(outstanding.mood ? {} : { style: 'positive' }),
              data: { kind: 'startPulse' },
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
 * Birthdays, anniversaries and new joiners.
 *
 * Returns null when there is nothing today rather than a card saying so — an empty
 * "nobody is celebrating" card is noise every single day it is not someone's birthday.
 */
export function celebrationsCard(celebrations: Celebrations): AdaptiveCard | null {
  // Weight rather than markdown asterisks: TextBlock weight renders the same
  // everywhere, and a renderer with markdown switched off shows the asterisks raw.
  const groups: { emoji: string; label: string; names: string }[] = []
  if (celebrations.birthdays.length > 0) {
    groups.push({ emoji: '🎂', label: 'Birthdays', names: celebrations.birthdays.join(', ') })
  }
  for (const one of celebrations.anniversaries) {
    groups.push({
      emoji: '🎉',
      label: `${one.years} ${one.years === 1 ? 'year' : 'years'} at Infinity Learn`,
      names: one.name,
    })
  }
  if (celebrations.newJoiners.length > 0) {
    groups.push({ emoji: '👋', label: 'Just joined', names: celebrations.newJoiners.join(', ') })
  }
  if (groups.length === 0) return null

  return card([
    header('Around the team', 'Today at Infinity Learn'),
    body(
      groups.map((group) => ({
        type: 'ColumnSet',
        spacing: 'Default',
        columns: [
          {
            type: 'Column',
            width: 'auto',
            items: [{ type: 'TextBlock', text: group.emoji, size: 'Large', spacing: 'None' }],
          },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              {
                type: 'TextBlock',
                text: group.label,
                size: 'Small',
                weight: 'Bolder',
                isSubtle: true,
                wrap: true,
                spacing: 'None',
              },
              { type: 'TextBlock', text: group.names, wrap: true, spacing: 'None' },
            ],
          },
        ],
      })),
    ),
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
