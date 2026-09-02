/**
 * Every route is gated.
 *
 * A lint in the shape of a test, and the bug it exists for is specific: a page filtered
 * out of the sidebar but still reachable by typing its path. The nav table and the route
 * table are written separately in App.tsx — nine lines apart, which is exactly close
 * enough to look correct and far enough to drift when the tenth page is added.
 *
 * Reading the source rather than rendering it is deliberate. Rendering proves the routes
 * that exist behave; this proves that no route exists without a guard, which is the half
 * that fails silently.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUNDLES, type Permission } from './api/access'

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

/** Every `<Route path="..." element={...}>` in the shell, as [path, element]. */
function routes(): [string, string][] {
  const found: [string, string][] = []
  const pattern = /<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g
  for (const match of source.matchAll(pattern)) found.push([match[1], match[2]])
  return found
}

describe('the route table', () => {
  it('finds the routes at all, so a passing suite means something', () => {
    // Without this, a change to how routes are written turns every check below into a
    // vacuous pass over an empty list.
    expect(routes().length).toBeGreaterThanOrEqual(8)
  })

  it('guards every page behind a permission', () => {
    for (const [path, element] of routes()) {
      // The catch-all only redirects; there is nothing behind it to protect.
      if (path === '*') continue
      expect(element, `route ${path} is not wrapped in gate()`).toContain('gate(')
    }
  })

  it('asks for permissions that exist', () => {
    const known = new Set<Permission>([...BUNDLES.HR_HEAD])
    for (const [path, element] of routes()) {
      const asked = element.match(/gate\('([^']+)'/)
      if (!asked) continue
      expect(known.has(asked[1] as Permission), `route ${path} wants unknown ${asked[1]}`).toBe(
        true,
      )
    }
  })

  it('keeps the sidebar and the routes asking for the same thing', () => {
    // The drift this file is named after: a link hidden by one permission and a page
    // guarded by another means either a dead link or an open door.
    // The trailing comma is optional. A prettier-wrapped multi-line entry has one,
    // and without it the pattern ran past its own entry and paired a route with the
    // NEXT entry's permission — a failure that looked like drift and was not.
    const navPattern = /\{\s*to:\s*'([^']+)',[\s\S]*?needs:\s*'([^']+)',?\s*\}/g
    const nav = new Map<string, string>()
    for (const match of source.matchAll(navPattern)) nav.set(match[1], match[2])

    expect(nav.size).toBeGreaterThanOrEqual(8)

    for (const [path, element] of routes()) {
      const needed = nav.get(path)
      if (!needed) continue
      expect(element, `route ${path} does not match its sidebar entry`).toContain(`gate('${needed}'`)
    }
  })

  it('keeps Sales Insights out of the console entirely', () => {
    /*
     * Pulled for this phase, and this is what says so.
     *
     * The test used to assert the opposite — that the route existed and was gated
     * above an HRBP. The page and the permission both still exist, so nothing here
     * would fail if the route quietly came back; asserting its absence is what makes
     * that a decision rather than a drift.
     */
    // Against the parsed route table, not the raw text: the comment in App.tsx says
    // where the page went and names the file, so a string search finds itself.
    expect(routes().map(([path]) => path)).not.toContain('/sales')
    expect(source).not.toContain('<SalesInsights')

    // The permission itself is untouched: the server still grants it, and an Admin
    // still holds it. Only the console has stopped surfacing it.
    expect(BUNDLES.HR).not.toContain('sales.view')
    expect(BUNDLES.HR_ADMIN).toContain('sales.view')
  })
})
