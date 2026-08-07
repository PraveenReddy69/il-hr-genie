import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

/**
 * The router has to know the subpath too.
 *
 * On GitHub Pages the app lives at /<repo>/, so without this every route would be
 * matched against a path that still carries the repo prefix and nothing would match.
 * Vite substitutes BASE_URL at build time; it is '/' in dev.
 */
const basename = import.meta.env.BASE_URL

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
