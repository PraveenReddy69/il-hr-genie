import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Analytics } from './pages/Analytics'
import { Attendance } from './pages/Attendance'
import { Celebrations } from './pages/Celebrations'
import { Dashboard } from './pages/Dashboard'
import { Holidays } from './pages/Holidays'
import { People } from './pages/People'
import { PulseQuestions } from './pages/PulseQuestions'
import { SalesInsights } from './pages/SalesInsights'
import { Tickets } from './pages/Tickets'
import { Trends } from './pages/Trends'
import {
  AnalyticsIcon,
  AttendanceIcon,
  CelebrationsIcon,
  DashboardIcon,
  HistoryIcon,
  HolidaysIcon,
  PeopleIcon,
  PulseIcon,
  SalesIcon,
  TicketsIcon,
} from './components/Icons'
import { clearToken, fetchMe, isLive, isUnauthorized, signIn } from './api/client'
import { can, isConsoleRole, ROLE_LABEL, type Permission } from './api/access'
import type { Employee } from './api/types'

const SESSION_KEY = 'hr-genie-console'

/**
 * The sidebar, and the permission each entry needs.
 *
 * One table rather than a check per link: a route that is filtered out of the nav but
 * still reachable by typing the path is the classic version of this bug, so the same
 * list drives both the links and the guards below.
 */
const NAV: { to: string; label: string; Icon: typeof DashboardIcon; needs: Permission }[] = [
  { to: '/', label: 'Dashboard', Icon: DashboardIcon, needs: 'dashboard.view' },
  { to: '/tickets', label: 'Tickets', Icon: TicketsIcon, needs: 'tickets.view' },
  { to: '/people', label: 'People', Icon: PeopleIcon, needs: 'people.view' },
  { to: '/attendance', label: 'Attendance', Icon: AttendanceIcon, needs: 'attendance.view' },
  {
    to: '/celebrations',
    label: 'Celebrations',
    Icon: CelebrationsIcon,
    needs: 'celebrations.view',
  },
  { to: '/sales', label: 'Sales Insights', Icon: SalesIcon, needs: 'sales.view' },
  { to: '/pulse', label: 'Pulse questions', Icon: PulseIcon, needs: 'pulse.view' },
  { to: '/analytics', label: 'Analytics', Icon: AnalyticsIcon, needs: 'analytics.view' },
  { to: '/trends', label: 'History', Icon: HistoryIcon, needs: 'trends.view' },
  { to: '/holidays', label: 'Holidays', Icon: HolidaysIcon, needs: 'holidays.view' },
]

/**
 * A route the signed-in account may not open.
 *
 * Shown rather than redirected. A silent bounce to the dashboard reads as a broken
 * link, and somebody following a colleague's URL deserves to know the difference
 * between "gone" and "not yours".
 */
function NoAccess() {
  return (
    <div className="page">
      <h1 className="page__title">Not your access</h1>
      <p className="page__lede">
        This page is outside what your account can open. Ask an Admin if you need it.
      </p>
    </div>
  )
}

export default function App() {
  const [hr, setHr] = useState<Employee | null>(() => {
    const stored = sessionStorage.getItem(SESSION_KEY)
    return stored ? (JSON.parse(stored) as Employee) : null
  })

  function onSignedIn(employee: Employee) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(employee))
    setHr(employee)
  }

  /**
   * Re-reads the signed-in record on load.
   *
   * The stored copy is whatever the server said at sign-in, and a tab can outlive a
   * change to it — a rename showed the old name until someone signed out. A failed
   * read keeps the cached record, except for a 401, which means the token is no
   * longer good and the session should end rather than half-work.
   */
  useEffect(() => {
    if (!hr) return
    let cancelled = false
    fetchMe()
      .then((fresh) => {
        if (cancelled) return
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(fresh))
        setHr(fresh)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isUnauthorized(error)) signOut()
      })
    return () => {
      cancelled = true
    }
    // Runs once per session: re-reading on every hr change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY)
    // The bearer token outlives the session record otherwise, and the next sign-in
    // would carry the old one until it was replaced.
    clearToken()
    setHr(null)
  }

  if (!hr) return <SignIn onSignedIn={onSignedIn} />

  const gate = (needs: Permission, page: React.ReactElement) =>
    can(hr, needs) ? page : <NoAccess />

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar__brand">
          <img
            className="sidebar__mark"
            src={`${import.meta.env.BASE_URL}hr-genie-mark.png`}
            alt=""
          />
          <div>
            <div className="sidebar__title">HR Genie</div>
            <div className="sidebar__subtitle">{ROLE_LABEL[hr.role]} console</div>
          </div>
        </div>

        {NAV.filter((item) => can(hr, item.needs)).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
            }
          >
            <item.Icon className="sidebar__icon" />
            {item.label}
          </NavLink>
        ))}

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="sidebar__avatar">{initials(hr.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{hr.name}</div>
              <div className="sidebar__subtitle">{hr.employeeId}</div>
            </div>
          </div>
          <button className="sidebar__signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="main">
        <Routes>
          <Route path="/" element={gate('dashboard.view', <Dashboard hrName={hr.name} />)} />
          <Route
            path="/tickets"
            element={gate('tickets.view', <Tickets actorId={hr.employeeId} viewer={hr} />)}
          />
          <Route path="/people" element={gate('people.view', <People viewer={hr} />)} />
          <Route path="/attendance" element={gate('attendance.view', <Attendance />)} />
          <Route
            path="/celebrations"
            element={gate('celebrations.view', <Celebrations viewer={hr} />)}
          />
          <Route path="/sales" element={gate('sales.view', <SalesInsights />)} />
          <Route path="/pulse" element={gate('pulse.view', <PulseQuestions editable={can(hr, 'pulse.publish')} />)} />
          <Route path="/analytics" element={gate('analytics.view', <Analytics />)} />
          <Route path="/trends" element={gate('trends.view', <Trends />)} />
          <Route path="/holidays" element={gate('holidays.view', <Holidays editable={can(hr, 'holidays.edit')} />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

/**
 * The console is HR-only, so the gate checks the role rather than just the id — an
 * employee signing in here should be turned away, not shown their colleagues.
 */
function SignIn({ onSignedIn }: { onSignedIn: (employee: Employee) => void }) {
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const employee = await signIn(employeeId, password)
      if (!isConsoleRole(employee.role)) {
        setError('This console is for HR accounts. Employees use the mobile app.')
        return
      }
      onSignedIn(employee)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <form className="signin__card" onSubmit={submit}>
        <div className="signin__mark">
          {/* Same mark as the employee app, so the two read as one product. */}
          <img src={`${import.meta.env.BASE_URL}hr-genie-mark.png`} alt="" />
        </div>

        <h1 className="signin__title">HR Genie</h1>
        <p className="signin__subtitle">
          The HRBP console. Sign in with your HR employee ID.
        </p>

        <div className="signin__field">
          <label className="signin__label" htmlFor="employee-id">
            Employee ID
          </label>
          <input
            id="employee-id"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            placeholder="HYD609552"
            autoFocus
            autoComplete="off"
          />
        </div>

        <div className="signin__field">
          <label className="signin__label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button
          className="button"
          type="submit"
          disabled={busy || !employeeId.trim() || !password}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {!isLive && (
          <>
            <p className="signin__hint">
              Running on mock data — any password works. Use{' '}
              <strong>HYD609552</strong> for an HRBP or <strong>HYD604982</strong> for
              an Admin.
            </p>
            <span className="env-flag">Mock data</span>
          </>
        )}

        <div className="signin__footer">
          {/* Wordmark only — the round mark is far too detailed to read at this
              size, and repeating it would compete with the one above. */}
          <span className="signin__brand">Infinity Learn</span>
        </div>
        <p className="signin__legal">
          Employees use the mobile app. This console is for the HR team.
        </p>
      </form>
    </div>
  )
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}
