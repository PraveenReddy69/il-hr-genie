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
    expect(routes().length).toBeGreaterThanOrEqual(9)
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
    const navPattern = /\{\s*to:\s*'([^']+)',[\s\S]*?needs:\s*'([^']+)'\s*\}/g
    const nav = new Map<string, string>()
    for (const match of source.matchAll(navPattern)) nav.set(match[1], match[2])

    expect(nav.size).toBeGreaterThanOrEqual(9)

    for (const [path, element] of routes()) {
      const needed = nav.get(path)
      if (!needed) continue
      expect(element, `route ${path} does not match its sidebar entry`).toContain(`gate('${needed}'`)
    }
  })

  it('puts Sales Insights out of an HRBP reach', () => {
    // Named rather than left to the table: it is the one page whose tier was a judgement
    // call rather than a consequence, so a silent change to it should fail here.
    expect(BUNDLES.HR).not.toContain('sales.view')
    expect(BUNDLES.HR_ADMIN).toContain('sales.view')
    expect(source).toContain("gate('sales.view'")
  })
})
