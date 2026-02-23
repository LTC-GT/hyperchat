/**
 * Identity management for quibble.
 *
 * Identity is stored in an Autobase-backed local Hypercore store so the
 * canonical state can evolve with schema versions while remaining append-only.
 *
 * We derive the Ed25519 keypair from a 24-word seed phrase (BIP39 entropy).
 * This enables multi-device identity recovery by importing the same phrase.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Corestore from 'corestore'
import b4a from 'b4a'
import {
  generateMnemonic,
  validateMnemonic,
  entropyToMnemonic,
  mnemonicToEntropy,
  wordlists
} from 'bip39'

const require = createRequire(import.meta.url)
const Autobase = require('autobase')
const crypto = require('hypercore-crypto')
const sodium = require('sodium-universal')

const QUIBBLE_DIR = path.join(os.homedir(), '.quibble')
const LEGACY_IDENTITY_DIR = path.join(os.homedir(), '.neet')
const LEGACY_ID_PATH = path.join(LEGACY_IDENTITY_DIR, 'identity.json')
const IDENTITY_DB_DIR = 'identity-hyperdb'
const IDENTITY_SCHEMA = 'quibble.identity.v1'

function openIdentityView (store) {
  return store.get('identity-view', { valueEncoding: 'json' })
}

async function applyIdentity (nodes, view) {
  for (const node of nodes) {
    const value = node?.value
    if (!value || value.type !== 'identity-state') continue
    await view.append(value)
  }
}

function normalizeSeedPhrase (seedPhrase) {
  return String(seedPhrase || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function seedPhraseToEntropy (seedPhrase) {
  const phrase = normalizeSeedPhrase(seedPhrase)
  if (!phrase || !validateMnemonic(phrase, wordlists.english)) {
    throw new Error('Invalid seed phrase. Expected a valid 24-word phrase.')
  }

  const entropyHex = mnemonicToEntropy(phrase, wordlists.english)
  return { phrase, entropy: b4a.from(entropyHex, 'hex') }
}

function entropyToSeedPhrase (entropy) {
  return entropyToMnemonic(b4a.toString(entropy, 'hex'), wordlists.english)
}

function keypairFromSeedPhrase (seedPhrase) {
  const { phrase, entropy } = seedPhraseToEntropy(seedPhrase)
  const kp = crypto.keyPair(entropy)
  return {
    seedPhrase: phrase,
    publicKey: kp.publicKey,
    secretKey: kp.secretKey
  }
}

function buildIdentityState ({ seedPhrase, name = 'anon' }) {
  return {
    type: 'identity-state',
    schema: IDENTITY_SCHEMA,
    seedPhrase: normalizeSeedPhrase(seedPhrase),
    name: String(name || 'anon').trim() || 'anon',
    updatedAt: Date.now()
  }
}

async function openIdentityBase (dir) {
  const storePath = path.join(dir, IDENTITY_DB_DIR)
  fs.mkdirSync(dir, { recursive: true })

  const store = new Corestore(storePath)
  await store.ready()

  const base = new Autobase(store, null, {
    open: openIdentityView,
    apply: applyIdentity,
    valueEncoding: 'json',
    ackInterval: 1000
  })
  await base.ready()

  return { store, base }
}

async function closeIdentityBase ({ base, store }) {
  try { await base?.close?.() } catch {}
  try { await store?.close?.() } catch {}
}

async function readCurrentIdentityState (base) {
  await base.update()
  const view = base.view
  if (!view || view.length === 0) return null

  const state = await view.get(view.length - 1)
  if (!state?.seedPhrase) return null
  return state
}

function deriveSeedPhraseFromLegacyIdentity (legacy) {
  const secret = b4a.from(legacy.secretKey, 'hex')
  const entropy = secret.length >= 32 ? secret.subarray(0, 32) : crypto.discoveryKey(secret).subarray(0, 32)
  return entropyToSeedPhrase(entropy)
}

function readLegacyIdentity (dir) {
  const legacyPath = path.join(dir, 'identity.json')
  if (!fs.existsSync(legacyPath)) return null

  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
    if (!legacy?.secretKey || !legacy?.publicKey) return null
    return {
      path: legacyPath,
      data: legacy
    }
  } catch {
    return null
  }
}

async function writeIdentityState (dir, state) {
  const db = await openIdentityBase(dir)
  try {
    await db.base.append(state)
  } finally {
    await closeIdentityBase(db)
  }
}

async function ensureIdentityState (dir, name = 'anon') {
  const db = await openIdentityBase(dir)

  try {
    const existing = await readCurrentIdentityState(db.base)
    if (existing) return existing

    const legacy = readLegacyIdentity(dir) || (dir !== LEGACY_IDENTITY_DIR ? readLegacyIdentity(LEGACY_IDENTITY_DIR) : null)
    if (legacy) {
      const migrated = buildIdentityState({
        seedPhrase: deriveSeedPhraseFromLegacyIdentity(legacy.data),
        name: legacy.data.name || name
      })
      await db.base.append(migrated)
      return migrated
    }

    const freshSeedPhrase = generateMnemonic(256, undefined, wordlists.english)
    const created = buildIdentityState({ seedPhrase: freshSeedPhrase, name })
    await db.base.append(created)
    return created
  } finally {
    await closeIdentityBase(db)
  }
}

/**
 * Generate a fresh Ed25519 keypair.
 * @returns {{ publicKey: Buffer, secretKey: Buffer }}
 */
export function generateKeypair () {
  return crypto.keyPair()
}

/**
 * Load identity from local Hypercore-backed state, creating one if missing.
 * @param {object} [opts]
 * @param {string} [opts.name='anon'] - Display name to store alongside the key.
 * @param {string} [opts.dir] - Override the identity directory.
 * @returns {Promise<{ publicKey: Buffer, secretKey: Buffer, seedPhrase: string, name: string, dir: string }>}
 */
export async function loadIdentity (opts = {}) {
  const dir = opts.dir || QUIBBLE_DIR
  const name = String(opts.name || 'anon').trim() || 'anon'
  const state = await ensureIdentityState(dir, name)
  const kp = keypairFromSeedPhrase(state.seedPhrase)

  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    seedPhrase: kp.seedPhrase,
    name: state.name || name,
    dir
  }
}

/**
 * Update the display name stored in identity state.
 */
export async function setName (name, dir) {
  dir = dir || QUIBBLE_DIR
  const state = await ensureIdentityState(dir)
  const next = buildIdentityState({
    seedPhrase: state.seedPhrase,
    name: String(name || '').trim() || 'anon'
  })
  await writeIdentityState(dir, next)
}

/**
 * Read the current seed phrase.
 */
export async function getSeedPhrase (opts = {}) {
  const dir = opts.dir || QUIBBLE_DIR
  const state = await ensureIdentityState(dir, opts.name || 'anon')
  return normalizeSeedPhrase(state.seedPhrase)
}

/**
 * Import (replace) identity from seed phrase.
 */
export async function importSeedPhrase (seedPhrase, opts = {}) {
  const dir = opts.dir || QUIBBLE_DIR
  const normalized = normalizeSeedPhrase(seedPhrase)
  const words = normalized ? normalized.split(' ') : []

  if (words.length !== 24) {
    throw new Error('Seed phrase must contain exactly 24 words.')
  }

  const { phrase } = seedPhraseToEntropy(normalized)
  const current = await ensureIdentityState(dir, opts.name || 'anon')
  const next = buildIdentityState({
    seedPhrase: phrase,
    name: String(opts.name || current.name || 'anon').trim() || 'anon'
  })

  await writeIdentityState(dir, next)
  return next
}

/**
 * Sign arbitrary data with our secret key.
 */
export function sign (data, secretKey) {
  const sig = b4a.allocUnsafe(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, data, secretKey)
  return sig
}

/**
 * Verify a signature.
 */
export function verify (data, signature, publicKey) {
  return sodium.crypto_sign_verify_detached(signature, data, publicKey)
}

export { QUIBBLE_DIR, LEGACY_ID_PATH }
