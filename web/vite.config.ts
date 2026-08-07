import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * GitHub Pages serves a project site from `/<repo>/`, not from the domain root, so
 * every asset URL has to be prefixed. The workflow passes the repo name in; locally
 * it stays '/' so `npm run dev` is unaffected.
 */
const base = normaliseBase(process.env.VITE_BASE_PATH)

/**
 * Vite needs a base with a leading and trailing slash.
 *
 * Normalised rather than trusted so passing a bare repo name works, and so a value
 * mangled by a shell (Git Bash rewrites a leading slash into a Windows path) fails
 * loudly here rather than producing a bundle whose asset URLs are subtly wrong.
 */
function normaliseBase(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '/') return '/'
  if (trimmed.includes(':')) {
    throw new Error(
      `VITE_BASE_PATH looks like a filesystem path, not a URL prefix: ${trimmed}`,
    )
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

/**
 * Pages has no SPA fallback: a refresh on /tickets asks the server for a file that
 * does not exist and gets the 404 page. Serving index.html as that 404 page means the
 * app boots and the router takes over, so deep links and refreshes work.
 */
function spaFallback() {
  return {
    name: 'spa-fallback-404',
    closeBundle() {
      const dist = resolve(__dirname, 'dist')
      copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), spaFallback()],
  server: {
    port: 5173,
    // The hackathon demo runs from other machines on the same network.
    host: true,
  },
})
