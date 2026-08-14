/**
 * Puts `src/assets` beside the compiled output.
 *
 * `tsc` compiles TypeScript and copies nothing else, so the card artwork would be
 * missing from `dist` and every glyph would 404 at runtime.
 *
 * The artwork lives under `src/` rather than at the project root on purpose: the
 * deployment pipeline ships the `src` directory, so anything outside it never reaches
 * the server. That is not a detail worth relearning through a card full of broken
 * images — see the note in index.ts.
 *
 *     node scripts/copy-assets.mjs      (runs as part of `npm run build`)
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const from = fileURLToPath(new URL('../src/assets', import.meta.url))
const to = fileURLToPath(new URL('../dist/assets', import.meta.url))

if (!existsSync(from)) {
  console.error(`No assets at ${from}`)
  process.exit(1)
}

mkdirSync(to, { recursive: true })
cpSync(from, to, { recursive: true })
console.log(`assets -> ${to}`)
