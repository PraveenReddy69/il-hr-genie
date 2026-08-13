/**
 * Builds the Teams app package.
 *
 * The manifest in `appPackage/` is a template: the bot id is not known until there is
 * a registration, and SSO adds a field that must hold a real client id or not be there
 * at all. This fills those in from `.env` and refuses to produce a package that would
 * be rejected on import — a zip that fails validation in the Developer Portal tells
 * you almost nothing about which field was wrong.
 *
 *   node scripts/package.mjs            # reads MICROSOFT_APP_ID from .env
 *   node scripts/package.mjs <app-id>   # or pass one
 *
 * No dependencies: the archive is written here, stored rather than deflated. Teams
 * accepts that, and a build step is a poor reason to add a package.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fromEnvFile(key) {
  try {
    const line = readFileSync(join(root, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((row) => row.trim().startsWith(`${key}=`))
    return line?.slice(line.indexOf('=') + 1).trim() || undefined
  } catch {
    return undefined
  }
}

// Flags are filtered out, so `--bump` is not mistaken for an app id.
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const appId = positional[0] ?? process.env.MICROSOFT_APP_ID ?? fromEnvFile('MICROSOFT_APP_ID')
const ssoConnection = process.env.SSO_CONNECTION_NAME ?? fromEnvFile('SSO_CONNECTION_NAME')

if (!appId || !GUID.test(appId)) {
  console.error(
    appId
      ? `MICROSOFT_APP_ID is "${appId}", which is not a GUID.`
      : 'No MICROSOFT_APP_ID. Register the bot first, then put its app id in teams/.env.',
  )
  console.error('\nUntil there is a registration there is nothing to install: Teams routes')
  console.error('messages by bot id, and an unregistered one is refused before it reaches you.')
  process.exit(1)
}

const manifestPath = join(root, 'appPackage/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

/**
 * `--bump` raises the patch version and writes it back.
 *
 * Teams will not accept an update that carries the same version as the one already
 * installed — and it does not say so. It reports success and keeps serving the old
 * package, which looks exactly like a change that did not take effect.
 */
if (process.argv.includes('--bump')) {
  const parts = String(manifest.version).split('.').map(Number)
  while (parts.length < 3) parts.push(0)
  parts[2] += 1
  manifest.version = parts.join('.')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`version -> ${manifest.version}`)
}

manifest.id = appId
manifest.bots[0].botId = appId

/**
 * Where the bot and its tabs are reachable. Needed before the SSO block, because the
 * App ID URI depends on the tab domain — see below.
 */
const publicBase = (process.env.PUBLIC_BASE_URL ?? fromEnvFile('PUBLIC_BASE_URL') ?? '')
  .trim()
  .replace(/\/$/, '')

let publicHost = ''
if (publicBase) {
  try {
    publicHost = new URL(publicBase).host
  } catch {
    console.error(`PUBLIC_BASE_URL is not a URL: ${publicBase}`)
    process.exit(1)
  }
}

/**
 * SSO is declared only when it is configured.
 *
 * `webApplicationInfo` holding a placeholder fails validation, and holding a stale id
 * fails at token exchange with an error that points nowhere near the manifest.
 * Leaving it out is the honest state of an app that does not have SSO yet.
 *
 * The `resource` form depends on what the app contains. A bot alone takes
 * `api://botid-<appid>`. Add a tab that signs in and Teams checks the URI against the
 * iframe's origin, rejecting the bot-only form with "App resource defined in manifest
 * and iframe origin do not match" — so an app with both needs
 * `api://<tab-host>/botid-<appid>`. Whatever is emitted here must also be the
 * Application ID URI in Entra and the Token Exchange URL on the Azure OAuth
 * connection; all three are compared as exact strings.
 */
if (ssoConnection) {
  const resource = publicHost
    ? `api://${publicHost}/botid-${appId}`
    : `api://botid-${appId}`
  manifest.webApplicationInfo = { id: appId, resource }
  console.log(`  SSO resource ${resource}`)
} else {
  delete manifest.webApplicationInfo
  console.warn('! No SSO_CONNECTION_NAME — packaging without SSO.')
  console.warn('  Nobody can sign in: there is no shared account to fall back to.\n')
}

/**
 * The "Around the team" tab.
 *
 * `contentUrl` has to be absolute, so it comes from PUBLIC_BASE_URL — the tunnel now,
 * a real host later. The host is added to validDomains at the same time: Teams
 * refuses to load a tab whose domain is not listed, and does it silently, showing an
 * empty frame with nothing in any log.
 *
 * Without the variable the tab is left out entirely rather than shipped pointing at
 * a dead URL.
 */
if (publicBase) {
  const host = publicHost
  // Chat first: it is the only surface you can ask something. The rest are things
  // you look at, which is why they earned tabs of their own.
  manifest.staticTabs = [
    { entityId: 'conversations', scopes: ['personal'] },
    {
      entityId: 'hrgenie.tickets',
      name: 'My tickets',
      contentUrl: `${publicBase}/tab/tickets`,
      scopes: ['personal'],
    },
    {
      entityId: 'hrgenie.pulse',
      name: 'Pulse',
      contentUrl: `${publicBase}/tab/pulse`,
      scopes: ['personal'],
    },
    {
      entityId: 'hrgenie.holidays',
      name: 'Holidays',
      contentUrl: `${publicBase}/tab/holidays`,
      scopes: ['personal'],
    },
    {
      entityId: 'hrgenie.celebrations',
      name: 'Around the team',
      contentUrl: `${publicBase}/tab/celebrations`,
      scopes: ['personal'],
    },
  ]
  if (!manifest.validDomains.includes(host)) manifest.validDomains.push(host)
} else {
  delete manifest.staticTabs
  console.warn('! No PUBLIC_BASE_URL — packaging without the "Around the team" tab.\n')
}

const leftover = JSON.stringify(manifest).match(/\$\{\{[^}]+\}\}|<[a-z-]+>/gi)
if (leftover) {
  console.error(`Unfilled placeholders in the manifest: ${[...new Set(leftover)].join(', ')}`)
  process.exit(1)
}

/**
 * The v1.17 manifest schema, as far as the top level goes.
 *
 * Taken from the schema `$schema` pins, which is why hard-coding it is safe: the
 * version cannot drift without someone editing that line. `additionalProperties` is
 * `false` there, so an unrecognised key is fatal rather than ignored — `packageName`
 * was carried over from an older manifest and failed the upload with "we couldn't
 * parse the app manifest", which names neither the field nor the reason.
 *
 * Catching it here costs nothing. Catching it in Teams costs a round trip through an
 * admin.
 */
const ALLOWED = new Set([
  '$schema', 'accentColor', 'activities', 'authorization', 'bots', 'composeExtensions',
  'configurableProperties', 'configurableTabs', 'connectors', 'dashboardCards',
  'defaultBlockUntilAdminAction', 'defaultGroupCapability', 'defaultInstallScope',
  'description', 'developer', 'devicePermissions', 'extensions', 'graphConnector',
  'icons', 'id', 'isFullScreen', 'localizationInfo', 'manifestVersion',
  'meetingExtensionDefinition', 'name', 'permissions', 'publisherDocsUrl',
  'showLoadingIndicator', 'staticTabs', 'subscriptionOffer', 'supportedChannelTypes',
  'validDomains', 'version', 'webApplicationInfo',
])
const REQUIRED = ['accentColor', 'description', 'developer', 'icons', 'id',
  'manifestVersion', 'name', 'version']

const unknown = Object.keys(manifest).filter((key) => !ALLOWED.has(key))
const missing = REQUIRED.filter((key) => manifest[key] === undefined)
if (unknown.length || missing.length) {
  if (unknown.length) {
    console.error(`Not allowed by the v${manifest.manifestVersion} schema: ${unknown.join(', ')}`)
  }
  if (missing.length) console.error(`Required and missing: ${missing.join(', ')}`)
  console.error('\nTeams rejects the whole package for either, without naming the field.')
  process.exit(1)
}

/**
 * Rules Teams enforces that the JSON schema does not.
 *
 * The schema calls `version` a string and is satisfied; Teams then refuses `0.1.0`
 * on upload because a leading zero reads as pre-release. Schema-valid is not the same
 * as acceptable, so anything learned from a rejection belongs here.
 */
if (/^0\./.test(String(manifest.version))) {
  console.error(`version is ${manifest.version}. Teams rejects anything starting with 0.`)
  console.error('Use 1.0.0 or higher, and increment it on every re-upload.')
  process.exit(1)
}

const files = [
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
  ['color.png', readFileSync(join(root, 'appPackage/color.png'))],
  ['outline.png', readFileSync(join(root, 'appPackage/outline.png'))],
]

// --------------------------------------------------------------- the archive
//
// Everything below is declarations; the write happens at the very bottom. `const` is
// not hoisted, so building the archive up here would reach CRC_TABLE before it exists.

/** Store-only ZIP. Fixed timestamps, so the same inputs give the same bytes. */
function zip(entries) {
  const DOS_TIME = 0x6000 // 12:00:00
  const DOS_DATE = 0x5a21 // 2025-01-01
  const locals = []
  const central = []
  let offset = 0

  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, data)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4) // version made by
    entry.writeUInt16LE(20, 6) // version needed
    entry.writeUInt16LE(0, 8)
    entry.writeUInt16LE(0, 10)
    entry.writeUInt16LE(DOS_TIME, 12)
    entry.writeUInt16LE(DOS_DATE, 14)
    entry.writeUInt32LE(sum, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(0, 30) // extra + comment lengths
    entry.writeUInt16LE(0, 34) // disk number
    entry.writeUInt16LE(0, 36) // internal attrs
    entry.writeUInt32LE(0, 38) // external attrs
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBytes)

    offset += 30 + nameBytes.length + data.length
  }

  const localPart = Buffer.concat(locals)
  const centralPart = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralPart.length, 12)
  end.writeUInt32LE(localPart.length, 16)

  return Buffer.concat([localPart, centralPart, end])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let sum = 0xffffffff
  for (const byte of buffer) sum = CRC_TABLE[(sum ^ byte) & 0xff] ^ (sum >>> 8)
  return (sum ^ 0xffffffff) >>> 0
}

// ------------------------------------------------------------------- and go

mkdirSync(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist/hr-genie-teams.zip')
writeFileSync(out, zip(files))

console.log(`Built ${out}`)
console.log(`  bot id  ${appId}`)
console.log(`  SSO     ${ssoConnection ? `on (${ssoConnection})` : 'off'}`)
console.log('\nTeams → Apps → Manage your apps → Upload an app → Upload a custom app')
