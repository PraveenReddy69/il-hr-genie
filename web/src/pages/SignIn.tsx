import { useState } from 'react'
import logo from '../infinity-learn.png'
import { isConsoleRole } from '../api/access'
import { isLive, isUnauthorized, signIn } from '../api/client'
import type { Employee } from '../api/types'

/**
 * The console's front door.
 *
 * Two halves: the left says what this is to somebody who has never seen it, the right
 * gets a returning HRBP in. Only the right half is on screen below 900px — the pitch is
 * for a first visit on a laptop, and on a phone it would push the form off the fold.
 */

/** Remembered across visits: the id only, never the password and never the token. */
const REMEMBERED = 'hr-genie-employee-id'

export function SignIn({ onSignedIn }: { onSignedIn: (employee: Employee) => void }) {
  const remembered = readRemembered()
  const [employeeId, setEmployeeId] = useState(remembered ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(remembered !== null)
  const [reveal, setReveal] = useState(false)
  const [helping, setHelping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
   * Whether the *credentials* were refused, as opposed to anything else going wrong.
   *
   * Only this paints the fields red. A dropped connection, or an employee signing in
   * to a console that is not for them, are both failures — but marking the two boxes
   * red would tell somebody their password is wrong when it is not, and they would
   * spend the next five minutes retyping a password that was always correct.
   */
  const [refused, setRefused] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const employee = await signIn(employeeId, password)
      if (!isConsoleRole(employee.role)) {
        // The password was right. The account is simply not for this console.
        setError('This console is for HR accounts. Employees use HR Genie in Teams.')
        return
      }
      // Written only once the id is known to be real, so a typo is not remembered.
      try {
        if (remember) localStorage.setItem(REMEMBERED, employee.employeeId)
        else localStorage.removeItem(REMEMBERED)
      } catch {
        // Private browsing, or storage is full. Not worth failing a sign-in over.
      }
      onSignedIn(employee)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign in.')
      setRefused(isUnauthorized(failure))
    } finally {
      setBusy(false)
    }
  }

  /** Typing is an answer to the refusal, so the red goes as soon as it starts. */
  function clear() {
    if (error) setError(null)
    if (refused) setRefused(false)
  }

  return (
    <div className="auth">
      <div className="auth__wash" aria-hidden="true" />

      <section className="auth__pitch">
        {/*
          The wordmark carries the company name, so there is no text beside it — set
          together they would print "Infinity Learn" twice. What stays underneath is the
          product, which the logo does not say.

          It is white artwork on transparency, which is why it appears only here. On the
          card it would be invisible; that keeps the blue tile.
        */}
        <div className="auth__brand">
          <img className="auth__logo" src={logo} alt="Infinity Learn, by Sri Chaitanya" />
          <span className="auth__brandsub">HR Dashboard Portal</span>
        </div>

        <h1 className="auth__headline">
          Empowering People.
          <br />
          Elevating <em>Workplaces.</em>
        </h1>
        <span className="auth__rule" aria-hidden="true" />

        <p className="auth__lead">
          A unified HR platform to simplify processes, empower teams, and drive a better
          employee experience.
        </p>

        <ul className="auth__points">
          <Point icon={<ShieldIcon />} title="Secure &amp; Trusted">
            Enterprise-grade security to keep your data safe.
          </Point>
          <Point icon={<PeopleIcon />} title="Employee Centric">
            Designed to support every employee journey.
          </Point>
          <Point icon={<InsightIcon />} title="Smarter Insights">
            Make data-driven decisions with real-time analytics.
          </Point>
        </ul>
      </section>

      <section className="auth__panel">
        <form className="authcard" onSubmit={submit}>
          {/*
            A badge, not a switcher. The mockup drew a dropdown, and there is one
            tenant — a chevron that opens nothing is a control that lies about what it
            can do.
          */}
          <span className="authcard__tenant">
            <BuildingIcon />
            Infinity Learn
          </span>

          <span className="authcard__hex">
            <MarkIcon />
          </span>

          <h2 className="authcard__title">Welcome back!</h2>
          <p className="authcard__sub">Sign in to access your HR Dashboard</p>

          {/*
            The label rides on the border rather than sitting above the field.
            `placeholder=" "` is load-bearing: `:placeholder-shown` is what tells CSS
            the field is empty, and an empty attribute does not count as a placeholder.
            The label's own order matters too — it follows the input so the sibling
            selector can reach it.
          */}
          <div className={`authfield ${refused ? 'authfield--bad' : ''}`}>
            <PersonIcon />
            <input
              id="employee-id"
              value={employeeId}
              onChange={(event) => {
                setEmployeeId(event.target.value)
                clear()
              }}
              placeholder=" "
              autoFocus={!remembered}
              autoComplete="username"
            />
            <label className="authfield__label" htmlFor="employee-id">
              Employee ID
            </label>
          </div>

          <div className={`authfield ${refused ? 'authfield--bad' : ''}`}>
            <LockIcon />
            <input
              id="password"
              type={reveal ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                clear()
              }}
              placeholder=" "
              autoFocus={remembered !== null}
              autoComplete="current-password"
            />
            <label className="authfield__label" htmlFor="password">
              Password
            </label>
            <button
              type="button"
              className="authfield__reveal"
              onClick={() => setReveal(!reveal)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              aria-pressed={reveal}
            >
              {reveal ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          {/*
            Directly under the pair, because that is what it is about. It sat above the
            button, two controls away from the boxes it was describing, which is far
            enough that the eye has to hunt for the connection.
          */}
          {error && (
            <p className="authcard__error" role="alert">
              {error}
            </p>
          )}

          <div className="authcard__row">
            <label className="authcheck">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span className="authcheck__box" aria-hidden="true">
                <TickIcon />
              </span>
              Remember me
            </label>
            <button
              type="button"
              className="authcard__forgot"
              onClick={() => setHelping(!helping)}
            >
              Forgot password?
            </button>
          </div>

          {/*
            Says who to ask rather than offering a reset this console cannot perform.
            There is no reset endpoint, and a link to one would be a dead end at the
            moment somebody is already locked out.
          */}
          {helping && (
            <p className="authcard__help">
              This console uses your HR Genie account. Ask your HR administrator to reset
              the password.
            </p>
          )}

          <button
            className="authbutton"
            type="submit"
            disabled={busy || !employeeId.trim() || !password}
          >
            {busy ? 'Signing in…' : 'Sign in'}
            {!busy && <ArrowIcon />}
          </button>

          {!isLive && (
            <p className="authcard__mock">
              Running on mock data — any password works. Use <strong>HYD609552</strong>{' '}
              for an HRBP or <strong>HYD604982</strong> for an Admin.
            </p>
          )}

          <div className="authcard__seal">
            <span className="authcard__sealrule" aria-hidden="true" />
            <ShieldIcon />
            <span className="authcard__sealrule" aria-hidden="true" />
          </div>
          <p className="authcard__assurance">
            Your data is safe with enterprise-grade security
          </p>

          <div className="authcard__foot">
            {/* The year is read, not typed: a hard-coded one is wrong every January. */}
            © {new Date().getFullYear()} Infinity Learn &nbsp;·&nbsp; All rights reserved
          </div>
        </form>

        <p className="auth__legal">
          Employees use HR Genie in Teams. This console is for the HR team.
        </p>
      </section>
    </div>
  )
}

function readRemembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED)
  } catch {
    return null
  }
}

function Point({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <li className="auth__point">
      <span className="auth__pointicon">{icon}</span>
      <span>
        <span className="auth__pointtitle">{title}</span>
        <span className="auth__pointbody">{children}</span>
      </span>
    </li>
  )
}

/* Stroked at 1.6 so they hold up at 20px, which is where most of them are drawn. */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/**
 * The mark on the two blue tiles.
 *
 * Not `hr-genie-mark.png`: that is the bot's own round mark, and on a blue tile it
 * reads as a dark disc inside a badge. This screen is the HR Dashboard Portal rather
 * than the bot, and the supplied design puts a people glyph here — filled, so it holds
 * at 32px where a stroked one would thin out.
 */
function MarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="8.6" cy="8.4" r="3.1" />
      <circle cx="16" cy="9.6" r="2.5" />
      <path d="M2.9 18.6c.5-3.1 2.8-5 5.7-5s5.2 1.9 5.7 5a.6.6 0 01-.6.7H3.5a.6.6 0 01-.6-.7z" />
      <path d="M15.5 14.1c2.2.1 3.9 1.6 4.4 4.2a.6.6 0 01-.6.7h-3.1c.1-1.9-.3-3.6-1.2-4.9z" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9.5-4.1-1.6-7-5.3-7-9.5V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </svg>
  )
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8" />
      <path d="M16.2 6.4a3 3 0 010 5.6M17.4 14.9c2.1.5 3.4 2.2 3.8 4.6" />
    </svg>
  )
}

function InsightIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M4 19.5h16" />
      <path d="M7 19.5v-5M12 19.5V8M17 19.5v-8" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} className="authfield__icon">
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M5.5 19.5c.7-3.4 3.3-5.4 6.5-5.4s5.8 2 6.5 5.4" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} className="authfield__icon">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8.4 10.5V7.8a3.6 3.6 0 017.2 0v2.7" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.9" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M4 4l16 16" />
      <path d="M9.9 6.2A9.6 9.6 0 0112 6c6 0 9.5 6 9.5 6a16 16 0 01-3.3 4" />
      <path d="M6.4 8.3A16 16 0 002.5 12S6 18 12 18c1.2 0 2.3-.2 3.3-.6" />
    </svg>
  )
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <rect x="4.5" y="4" width="9.5" height="16" rx="1.4" />
      <path d="M14 9.5h5.5V20H14" />
      <path d="M7.4 8h3.6M7.4 11.5h3.6M7.4 15h3.6" />
    </svg>
  )
}

function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S} className="authbutton__arrow">
      <path d="M5 12h13M12.5 5.5L19 12l-6.5 6.5" />
    </svg>
  )
}
