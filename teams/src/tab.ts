/**
 * The personal tabs: Around the team, Monthly pulse, Holidays.
 *
 * A Teams personal tab is an ordinary web page embedded in the app. These are served
 * from this process rather than from the console's Pages site so each page and the
 * data it fetches share an origin — no CORS, one thing to deploy, one URL to keep
 * alive.
 *
 * The data comes from the same `api.gateway` the cards use, so a tab cannot drift
 * from the chat: fix a mapping once and both surfaces get it.
 *
 * Why tabs at all, when the bot can already do these in chat: a pulse and a holiday
 * calendar are things you *look at*, not things you have a conversation about. Putting
 * them behind their own tab keeps the chat for the parts that are genuinely a
 * dialogue — asking a question, raising a ticket.
 *
 * Until SSO, every tab shows what the configured account can see, exactly as the bot
 * does.
 */

import * as api from './api.js'
import { holidaysFor, holidayYears, type Holiday } from './holidays.js'

// ------------------------------------------------------------------ the data

export async function celebrationsJson(): Promise<unknown> {
  const party = await api.gateway.celebrations()
  return {
    birthdays: party.birthdays,
    anniversaries: party.anniversaries,
    newJoiners: party.newJoiners,
  }
}

export async function ticketsJson(): Promise<unknown> {
  const tickets = await api.gateway.myTickets()
  return { tickets }
}

export async function pulseJson(): Promise<unknown> {
  const [questions, answers] = await Promise.all([
    api.gateway.pulseQuestions(),
    api.gateway.thisCyclesPulse().catch(() => null),
  ])
  return { questions, answers: answers ?? null }
}

export async function savePulseJson(answers: Record<string, string>): Promise<unknown> {
  await api.gateway.savePulse(answers)
  return { saved: true }
}

/** The calendar, with today marked so the page can lead with what is next. */
export function holidaysJson(year?: number): unknown {
  const now = new Date()
  const chosen = year ?? now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return {
    year: chosen,
    years: holidayYears(),
    today: `${now.getFullYear()}-${month}-${day}`,
    holidays: holidaysFor(chosen) as Holiday[],
  }
}

// ------------------------------------------------------------------ the shell

/**
 * One page skeleton for all three.
 *
 * `@microsoft/teams-js` on every page, because a tab that never calls
 * `app.initialize()` sits on Teams' loading spinner forever — the single most common
 * way a tab appears broken. Colours follow the viewer's light or dark preference
 * rather than us guessing at one palette.
 */
function page(title: string, subtitle: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="https://res.cdn.office.net/teams-js/2.24.0/js/MicrosoftTeams.min.js"></script>
<style>
  :root {
    --ink: #242424; --muted: #616161; --line: #e0e0e0;
    --surface: #ffffff; --page: #f5f5f5; --brand: #1a6fd6; --warn: #d97706; --ok: #2e7d32;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #ffffff; --muted: #adadad; --line: #383838;
      --surface: #292929; --page: #1f1f1f; --brand: #7cb8ff; --warn: #f59e0b; --ok: #4ade80;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--page); color: var(--ink);
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 14px;
  }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 12.5px; margin-bottom: 18px; }
  section { margin-bottom: 22px; }
  h2 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 0 0 8px;
  }
  .row {
    display: flex; align-items: center; gap: 12px; background: var(--surface);
    border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin-bottom: 8px;
  }
  .face { font-size: 22px; line-height: 1; flex-shrink: 0; }
  .who { flex: 1; min-width: 0; }
  .name { font-weight: 600; }
  .meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .tag {
    flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--muted);
    border: 1px solid var(--line); border-radius: 20px; padding: 3px 10px;
  }
  .tag--optional { color: var(--warn); border-color: var(--warn); }
  .tag--next { color: var(--brand); border-color: var(--brand); }
  button.act {
    flex-shrink: 0; border: 1px solid var(--brand); color: var(--brand);
    background: none; border-radius: 6px; padding: 6px 14px; font: inherit;
    font-weight: 600; cursor: pointer;
  }
  button.act:hover:not(:disabled) { background: var(--brand); color: #fff; }
  button.act:disabled { opacity: 0.5; cursor: default; }
  .q { background: var(--surface); border: 1px solid var(--line); border-radius: 8px;
       padding: 14px; margin-bottom: 10px; }
  .q .name { margin-bottom: 2px; }
  .opts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .opt {
    border: 1px solid var(--line); border-radius: 20px; padding: 7px 14px;
    cursor: pointer; font-size: 13px; background: var(--page);
  }
  /* Filled, not merely outlined. An outline reads as "hoverable" next to three other
     outlines; a filled chip is unambiguously the one that is chosen. */
  .opt.on {
    border-color: var(--brand); background: var(--brand); color: #fff; font-weight: 600;
  }
  .opt:hover:not(.on) { border-color: var(--brand); color: var(--brand); }
  .qnum {
    width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
    background: var(--line); color: var(--muted); font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .qnum.done { background: var(--brand); color: #fff; }
  .qhead { display: flex; align-items: flex-start; gap: 10px; }
  .progress {
    display: flex; align-items: center; gap: 10px; margin-bottom: 16px;
    color: var(--muted); font-size: 12.5px;
  }
  .progress-track {
    flex: 1; height: 4px; border-radius: 4px; background: var(--line); overflow: hidden;
  }
  .progress-fill { height: 100%; background: var(--brand); transition: width .18s ease; }
  .bar { position: sticky; bottom: 0; padding: 12px 0; background: var(--page); }
  .bar button { width: 100%; padding: 12px; }
  .bar button:not(:disabled) { background: var(--brand); color: #fff; }
  .empty, .error {
    color: var(--muted); background: var(--surface); border: 1px dashed var(--line);
    border-radius: 8px; padding: 22px; text-align: center;
  }
  .error { color: #c4314b; border-color: #c4314b; }
  .note { color: var(--muted); font-size: 11.5px; margin-top: 14px; line-height: 1.5; }

  /* The journey. A real connecting line, which Adaptive Cards cannot draw — the
     whole reason this view exists alongside the chat card. */
  .tl { position: relative; margin: 14px 0 0 8px; padding-left: 28px; }
  /* The line is drawn per segment, not once down the whole column, so each leg can
     carry the colour of the step it completes — amber to picked up, green to
     resolved. A leg not yet travelled stays grey. */
  .tl-item::before {
    content: ''; position: absolute; left: -21px; top: 18px; bottom: -16px;
    width: 2px; background: var(--line);
  }
  .tl-item:last-child::before { display: none; }
  .tl-item.seg-amber::before { background: var(--warn); }
  .tl-item.seg-green::before { background: var(--ok); }
  .tl-item { position: relative; margin-bottom: 14px; }
  .tl-item:last-child { margin-bottom: 0; }
  .tl-dot {
    position: absolute; left: -28px; top: 1px; width: 16px; height: 16px;
    border-radius: 50%; border: 2px solid var(--line); background: var(--page);
  }
  .tl-dot::after {
    content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--line);
  }
  .tl-dot.on { border-color: var(--warn); }
  .tl-dot.on::after { background: var(--warn); }
  /* Blue for the middle stop: amber says "waiting", green says "finished", and
     "someone is on it" is neither. */
  .tl-dot.prog { border-color: var(--brand); }
  .tl-dot.prog::after { background: var(--brand); }
  .tl-dot.done { border-color: var(--ok); }
  .tl-dot.done::after { background: var(--ok); }
  .tl-label { font-weight: 600; font-size: 13.5px; }
  .tl-when { color: var(--muted); font-size: 12px; margin-top: 1px; }
  .tl-item.pending .tl-label, .tl-item.pending .tl-when { color: var(--muted); font-weight: 500; }
  /* HR's reply. The one part of a ticket written by a person, so it is set apart
     rather than listed — an accent edge and a name, like a quote. */
  .reply {
    background: var(--page); border: 1px solid var(--line);
    border-left: 3px solid var(--ok); border-radius: 8px;
    padding: 13px 15px; margin-top: 16px;
  }
  .reply-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
  .reply-who {
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    background: var(--ok); color: #fff; font-size: 10.5px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; letter-spacing: 0.02em;
  }
  .reply-label {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); font-weight: 700;
  }
  .reply-body { font-size: 14.5px; line-height: 1.5; }
  .reply-when { color: var(--muted); font-size: 11.5px; margin-top: 8px; }

  /* The pulse, already answered. A quiet confirmation rather than a banner — it is
     the end of a task, not an announcement. */
  .done-card {
    display: flex; align-items: center; gap: 16px; margin-bottom: 18px;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 12px; padding: 20px 22px;
  }
  .done-mark {
    width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
    background: var(--ok); color: #fff; font-size: 21px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .done-title { font-size: 16.5px; font-weight: 700; letter-spacing: -0.01em; }
  .done-sub { color: var(--muted); font-size: 13px; margin-top: 3px; line-height: 1.45; }

  /* A date chip rather than an emoji. The date is the point of the row, so it leads,
     and the page reads as a calendar rather than a list with decoration. */
  .datechip {
    width: 46px; flex-shrink: 0; text-align: center; border-radius: 8px;
    border: 1px solid var(--line); background: var(--page); padding: 6px 0 5px;
  }
  .datechip-day { font-size: 18px; font-weight: 700; line-height: 1; letter-spacing: -0.02em; }
  .datechip-mon {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--muted); margin-top: 3px;
  }
  .row.past { opacity: 0.5; }
  .row.next { border-color: var(--warn); }
  .row.next .datechip { border-color: var(--warn); background: transparent; }
  .row.next .datechip-day, .row.next .datechip-mon { color: var(--warn); }
  /* Amber: a countdown is a "soon", not a status. */
  .countdown { font-size: 12px; color: var(--warn); font-weight: 700; margin-top: 3px; }
  .next-in { color: var(--warn); font-weight: 700; }

  /* Initials, not a repeated emoji. Seven identical cakes down a column carry no
     information; a person's initials tell you who the row is about at a glance. */
  .avatar {
    width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; position: relative;
    color: #fff; font-size: 13px; font-weight: 700; letter-spacing: 0.02em;
    display: flex; align-items: center; justify-content: center;
  }
  .avatar-badge {
    position: absolute; right: -3px; bottom: -3px; width: 17px; height: 17px;
    border-radius: 50%; background: var(--surface); border: 1px solid var(--line);
    font-size: 9.5px; display: flex; align-items: center; justify-content: center;
  }
  .count { color: var(--muted); font-weight: 600; }
</style>
</head>
<body>
  <h1>${title}</h1>
  <div class="sub">${subtitle}</div>
  <div id="out" class="empty">Loading…</div>
<script>
  if (window.microsoftTeams) { microsoftTeams.app.initialize().catch(function () {}) }
  var out = document.getElementById('out')
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function fail(e) {
    out.className = 'error'
    out.textContent = 'Could not load this. ' + (e && e.message ? e.message : e)
  }
${script}
</script>
</body>
</html>`
}

// ------------------------------------------------------------------ the pages

export const CELEBRATIONS_HTML = page(
  'Around the team',
  'Today at Infinity Learn',
  `
  var GREETING = {
    birthdays: function (p) { return 'Happy birthday, ' + first(p.name) + '! \\u{1F382}' },
    anniversaries: function (p) {
      return p.years
        ? 'Congratulations on ' + p.years + ' ' + (p.years === 1 ? 'year' : 'years') +
          ' at Infinity Learn, ' + first(p.name) + '! \\u{1F389}'
        : 'Congratulations on your work anniversary, ' + first(p.name) + '! \\u{1F389}'
    },
    newJoiners: function (p) { return 'Welcome to Infinity Learn, ' + first(p.name) + '! \\u{1F44B}' },
  }
  var SECTIONS = [
    ['birthdays', '\\u{1F382}', 'Birthdays'],
    ['anniversaries', '\\u{1F389}', 'Work anniversaries'],
    ['newJoiners', '\\u{1F44B}', 'New joiners'],
  ]
  function first(n) { return String(n || '').split(' ')[0] || n }
  function initials(n) {
    return String(n || '').split(' ').filter(Boolean).slice(0, 2)
      .map(function (w) { return w[0].toUpperCase() }).join('')
  }
  // A stable colour per person, so the same face keeps the same tint day to day.
  var TINTS = ['#2b8cff', '#7a5af8', '#0f9d76', '#e06c2b', '#c2185b', '#0277bd']
  function tint(n) {
    var sum = 0
    for (var i = 0; i < String(n).length; i++) sum += String(n).charCodeAt(i)
    return TINTS[sum % TINTS.length]
  }
  function detail(p, key) {
    var bits = []
    if (key === 'anniversaries' && p.years) bits.push(p.years + (p.years === 1 ? ' year' : ' years'))
    if (p.employeeId) bits.push(p.employeeId)
    if (p.designation) bits.push(p.designation)
    return bits.join(' \\u00b7 ') || 'Infinity Learn'
  }
  fetch('api/celebrations').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status); return r.json()
  }).then(function (data) {
    var html = ''
    SECTIONS.forEach(function (s) {
      var people = data[s[0]] || []
      if (!people.length) return
      html += '<section><h2>' + s[2] + ' <span class="count">' + people.length + '</span></h2>'
      people.forEach(function (p) {
        var wish = ''
        if (p.email) {
          var url = 'https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(p.email) +
            '&message=' + encodeURIComponent(GREETING[s[0]](p))
          wish = '<button class="act" data-url="' + esc(url) + '">Wish</button>'
        }
        html += '<div class="row"><div class="avatar" style="background:' + tint(p.name) + '">' +
          esc(initials(p.name)) + '<span class="avatar-badge">' + s[1] + '</span></div>' +
          '<div class="who"><div class="name">' + esc(p.name) + '</div>' +
          '<div class="meta">' + esc(detail(p, s[0])) + '</div></div>' + wish + '</div>'
      })
      html += '</section>'
    })
    if (!html) { out.className = 'empty'; out.textContent = 'Nothing to celebrate today. Back tomorrow.'; return }
    out.className = ''
    out.innerHTML = html
    // Teams blocks window.open from an embedded frame; its own opener is the way out.
    Array.prototype.forEach.call(document.querySelectorAll('.act'), function (b) {
      b.addEventListener('click', function () {
        var u = b.getAttribute('data-url')
        if (window.microsoftTeams && microsoftTeams.app && microsoftTeams.app.openLink) {
          microsoftTeams.app.openLink(u)
        } else { window.open(u, '_blank') }
      })
    })
  }).catch(fail)
`,
)

export const PULSE_HTML = page(
  'Monthly pulse',
  'A few questions, once a month. Your HRBP sees the totals, never who said what.',
  `
  var picked = {}
  fetch('api/pulse').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status); return r.json()
  }).then(function (data) {
    var qs = data.questions || []
    if (!qs.length) { out.className = 'empty'; out.textContent = 'No questions this cycle.'; return }
    picked = Object.assign({}, data.answers || {})

    /*
     * Answered already? Show it, do not re-ask.
     *
     * The Android app does the same. A pulse is once a month by design — presenting
     * the form again invites second-guessing, and an answer changed on a whim is
     * worse data than the first honest one. It is read-only until the next cycle.
     */
    if (data.answers && Object.keys(data.answers).length >= qs.length) {
      var cycle = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      var summary = '<div class="done-card"><div class="done-mark">✓</div><div>' +
        '<div class="done-title">' + cycle + ' pulse is in</div>' +
        '<div class="done-sub">Thank you — that is recorded and counted. ' +
        'The next one comes round at the start of next month.</div></div></div>' +
        '<h2>What you said</h2>'
      qs.forEach(function (q, i) {
        summary += '<div class="q"><div class="qhead">' +
          '<span class="qnum done">' + (i + 1) + '</span><div style="flex:1">' +
          '<div class="name">' + esc(q.text || q.question) + '</div>' +
          '<div class="opts"><div class="opt on">' + esc(picked[q.id] || '—') +
          '</div></div></div></div></div>'
      })
      out.className = ''
      out.innerHTML = summary
      return
    }

    var done = false
    var html = '<div class="progress"><span id="pcount"></span>' +
      '<span class="progress-track"><span class="progress-fill" id="pfill"></span></span></div>'
    qs.forEach(function (q, i) {
      var answered = picked[q.id] ? ' done' : ''
      html += '<div class="q"><div class="qhead"><span class="qnum' + answered + '" id="qn' + i + '">' +
        (i + 1) + '</span><div style="flex:1"><div class="name">' + esc(q.text || q.question) + '</div>'
      if (q.hint) html += '<div class="meta">' + esc(q.hint) + '</div>'
      html += '</div></div><div class="opts">'
      ;(q.options || []).forEach(function (o) {
        var on = picked[q.id] === o ? ' on' : ''
        html += '<div class="opt' + on + '" data-q="' + esc(q.id) + '" data-i="' + i +
          '" data-o="' + esc(o) + '">' + esc(o) + '</div>'
      })
      html += '</div></div>'
    })
    html += '<div class="bar"><button class="act" id="save" disabled>' +
      (done ? 'Update my answers' : 'Save') + '</button></div>'
    html += '<div class="note">You can change your answers any time this cycle \\u2014 ' +
      'the latest replaces the last. Answers are reported as totals across at least ' +
      'five people, never individually.</div>'
    out.className = ''
    out.innerHTML = html

    var save = document.getElementById('save')
    function refresh() {
      var done = Object.keys(picked).length
      save.disabled = done < qs.length
      document.getElementById('pcount').textContent = done + ' of ' + qs.length + ' answered'
      document.getElementById('pfill').style.width = Math.round((done / qs.length) * 100) + '%'
    }
    refresh()
    Array.prototype.forEach.call(document.querySelectorAll('.opt'), function (el) {
      el.addEventListener('click', function () {
        var q = el.getAttribute('data-q')
        picked[q] = el.getAttribute('data-o')
        Array.prototype.forEach.call(document.querySelectorAll('.opt[data-q="' + q + '"]'), function (s) {
          s.classList.remove('on')
        })
        el.classList.add('on')
        var n = document.getElementById('qn' + el.getAttribute('data-i'))
        if (n) n.classList.add('done')
        refresh()
      })
    })
    save.addEventListener('click', function () {
      save.disabled = true
      save.textContent = 'Saving\\u2026'
      fetch('api/pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(picked),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        out.className = 'empty'
        out.textContent = 'Thank you \\u2014 that is recorded. Reopen this tab to change it.'
      }).catch(function (e) {
        // Keep what was chosen: making someone answer four questions twice because
        // the network blinked is the worst thing this page could do.
        save.disabled = false
        save.textContent = 'Try again'
        alert('Could not save just then. Your answers are still here. ' + e.message)
      })
    })
  }).catch(fail)
`,
)

export const HOLIDAYS_HTML = page(
  'Holiday calendar',
  'Published dates for Infinity Learn',
  `
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  function pretty(iso) {
    var p = iso.split('-')
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0]
  }
  function weekday(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long' })
  }
  fetch('api/holidays').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status); return r.json()
  }).then(function (data) {
    var list = data.holidays || []
    if (!list.length) { out.className = 'empty'; out.textContent = 'No dates published for ' + data.year + '.'; return }
    var ahead = list.filter(function (h) { return h.isoDate >= data.today })
    var next = ahead.length ? ahead[0].isoDate : null
    // "Published" counted the list you are already looking at. What is worth saying
    // at the top is how long until the next one.
    var nd = next
      ? Math.round((new Date(next + 'T00:00:00') - new Date(data.today + 'T00:00:00')) / 86400000)
      : null
    var nextIn = nd === null ? ''
      : nd === 0 ? ' \u00b7 <span class="next-in">Next is today</span>'
      : nd === 1 ? ' \u00b7 <span class="next-in">Next is tomorrow</span>'
      : ' \u00b7 <span class="next-in">Next in ' + nd + ' days</span>'
    var html = '<section><h2>' + data.year + ' \u00b7 ' + ahead.length + ' still ahead' +
      nextIn + '</h2>'
    list.forEach(function (h) {
      var past = h.isoDate < data.today
      var isNext = h.isoDate === next
      var parts = h.isoDate.split('-')
      var days = Math.round(
        (new Date(h.isoDate + 'T00:00:00') - new Date(data.today + 'T00:00:00')) / 86400000
      )
      var when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'In ' + days + ' days'
      html += '<div class="row' + (past ? ' past' : '') + (isNext ? ' next' : '') + '">' +
        '<div class="datechip"><div class="datechip-day">' + Number(parts[2]) + '</div>' +
        '<div class="datechip-mon">' + MONTHS[Number(parts[1]) - 1] + '</div></div>' +
        '<div class="who"><div class="name">' + esc(h.name) + '</div>' +
        '<div class="meta">' + weekday(h.isoDate) + ' · ' + esc(h.region) + '</div>' +
        (isNext ? '<div class="countdown">' + when + '</div>' : '') + '</div>' +
        (h.kind === 'OPTIONAL'
          ? '<span class="tag tag--optional">Optional</span>'
          : '<span class="tag">Fixed</span>') +
        '</div>'
    })
    html += '</section><div class="note">Fixed days are paid holidays everyone gets. ' +
      'Optional days are chosen from the published list, and some are state-specific \\u2014 ' +
      'check with HR before planning around one.</div>'
    out.className = ''
    out.innerHTML = html
  }).catch(fail)
`,
)

export const TICKETS_HTML = page(
  'My tickets',
  'Everything you have raised with HR',
  `
  var STATUS = { OPEN: 'With HR', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved' }
  function stamp(ms) {
    var d = new Date(ms)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }
  fetch('api/tickets').then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status); return r.json()
  }).then(function (data) {
    var list = data.tickets || []
    if (!list.length) {
      out.className = 'empty'
      out.textContent = 'Nothing with HR right now. Raise one from the Chat tab.'
      return
    }
    var open = list.filter(function (t) { return t.status !== 'RESOLVED' }).length
    var html = '<section><h2>' + list.length + ' with HR · ' + open + ' still open</h2>'
    list.forEach(function (t, i) {
      var comments = (t.comments || []).slice().sort(function (a, b) { return a.atMillis - b.atMillis })
      // A comment's time where there is one, else updatedAtMillis for the stop the
      // ticket is on now — HR can move it without commenting, and that move has only
      // the one timestamp.
      var at = function (s) {
        var c = comments.filter(function (x) { return x.status === s })[0]
        if (c) return c.atMillis
        return s === t.status ? t.updatedAtMillis : undefined
      }
      var stops = [
        ['Raised', t.createdAtMillis, true],
        ['Picked up by HR', at('IN_PROGRESS'), t.status !== 'OPEN'],
        ['Resolved', at('RESOLVED'), t.status === 'RESOLVED'],
      ]
      var latest = comments.filter(function (c) { return c.text && c.text.trim() }).pop()
      html += '<div class="q"><div style="display:flex;gap:12px;align-items:flex-start">' +
        '<div class="who"><div class="name">' + esc(t.subject) + '</div>' +
        '<div class="meta">' + esc(t.id) + ' · ' + esc(t.category) + '</div></div>' +
        '<span class="tag' + (t.status === 'RESOLVED' ? '' : ' tag--next') + '">' +
        (STATUS[t.status] || t.status) + '</span></div>'
      html += '<div class="tl">'
      stops.forEach(function (s, si) {
        var tone = s[0] === 'Resolved' ? 'done' : s[0] === 'Raised' ? 'on' : 'prog'
        // The leg below this stop is coloured only once the next stop is reached.
        var next = stops[si + 1]
        var seg = next && next[2] ? (si === 0 ? ' seg-amber' : ' seg-green') : ''
        html += '<div class="tl-item' + (s[2] ? '' : ' pending') + seg + '">' +
          '<span class="tl-dot ' + (s[2] ? tone : '') + '"></span>' +
          '<div class="tl-label">' + s[0] + '</div>' +
          '<div class="tl-when">' + (s[1] ? stamp(s[1]) : (s[2] ? 'No comment recorded' : 'Not yet')) +
          '</div></div>'
      })
      html += '</div>'
      if (latest) {
        html += '<div class="reply">' +
          '<div class="reply-head"><span class="reply-who">HR</span>' +
          '<span class="reply-label">What HR said</span></div>' +
          '<div class="reply-body">' + esc(latest.text) + '</div>' +
          '<div class="reply-when">' + stamp(latest.atMillis) + '</div></div>'
      }
      html += '</div>'
    })
    out.className = ''
    out.innerHTML = html + '</section>'
  }).catch(fail)
`,
)
