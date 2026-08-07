import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Analytics } from './pages/Analytics'
import { Attendance } from './pages/Attendance'
import { Dashboard } from './pages/Dashboard'
import { Holidays } from './pages/Holidays'
import { People } from './pages/People'
import { Tickets } from './pages/Tickets'
import { Trends } from './pages/Trends'
import { clearToken, isLive, signIn } from './api/client'
import type { Employee } from './api/types'

const SESSION_KEY = 'hr-genie-console'

export default function App() {
  const [hr, setHr] = useState<Employee | null>(() => {
    const stored = sessionStorage.getItem(SESSION_KEY)
    return stored ? (JSON.parse(stored) as Employee) : null
  })

  function onSignedIn(employee: Employee) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(employee))
    setHr(employee)
  }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY)
    // The bearer token outlives the session record otherwise, and the next sign-in
    // would carry the old one until it was replaced.
    clearToken()
    setHr(null)
  }

  if (!hr) return <SignIn onSignedIn={onSignedIn} />

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__mark">🧞</span>
          <div>
            <div className="sidebar__title">HR Genie</div>
            <div className="sidebar__subtitle">HRBP console</div>
          </div>
        </div>

        {[
          { to: '/', label: 'Dashboard', icon: '◱' },
          { to: '/tickets', label: 'Tickets', icon: '🎫' },
          { to: '/people', label: 'People', icon: '👥' },
          { to: '/attendance', label: 'Attendance', icon: '⏱️' },
          { to: '/analytics', label: 'Analytics', icon: '📊' },
          { to: '/trends', label: 'History', icon: '📈' },
          { to: '/holidays', label: 'Holidays', icon: '🌴' },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`
            }
          >
            <span>{item.icon}</span>
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
          <Route path="/" element={<Dashboard hrName={hr.name} />} />
          <Route path="/tickets" element={<Tickets actorId={hr.employeeId} />} />
          <Route path="/people" element={<People />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/holidays" element={<Holidays />} />
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
      if (employee.role !== 'HR') {
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
        <div className="signin__mark">🧞</div>
        <h2 style={{ margin: 0, letterSpacing: '-0.02em' }}>HRBP console</h2>
        <p style={{ color: 'var(--text-secondary)', margin: '6px 0 0', fontSize: 13 }}>
          Sign in with your HR employee ID.
        </p>

        <input
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
          placeholder="HR000"
          autoFocus
          autoComplete="off"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        {error && <div className="error">{error}</div>}

        <button
          className="button"
          type="submit"
          disabled={busy || !employeeId.trim() || !password}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        {!isLive && (
          <>
            <p className="signin__hint">
              Running on mock data — any password works. Use <strong>HR000</strong>.
            </p>
            <span className="env-flag">Mock data</span>
          </>
        )}
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
