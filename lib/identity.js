/**
 * Identity management for neet.
 *
 * Each user has an Ed25519 keypair stored at ~/.neet/identity.json.
 * The keypair doubles as the user's Noise keypair for Hyperswarm
 * and as their signing identity inside rooms.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import b4a from 'b4a'

const require = createRequire(import.meta.url)
const crypto = require('hypercore-crypto')
const sodium = require('sodium-universal')

const NEET_DIR = path.join(os.homedir(), '.neet')
const ID_PATH = path.join(NEET_DIR, 'identity.json')

/**
 * Generate a fresh Ed25519 keypair.
 * @returns {{ publicKey: Buffer, secretKey: Buffer }}
 */
export function generateKeypair () {
  return crypto.keyPair()
}

/**
 * Load identity from disk, creating one if it doesn't exist.
 * @param {object} [opts]
 * @param {string} [opts.name='anon'] - Display name to store alongside the key.
 * @param {string} [opts.dir] - Override the identity directory.
 * @returns {{ publicKey: Buffer, secretKey: Buffer, name: string, dir: string }}
 */
export function loadIdentity (opts = {}) {
  const dir = opts.dir || NEET_DIR
  const idPath = path.join(dir, 'identity.json')

  if (fs.existsSync(idPath)) {
    const data = JSON.parse(fs.readFileSync(idPath, 'utf-8'))
    return {
      publicKey: b4a.from(data.publicKey, 'hex'),
      secretKey: b4a.from(data.secretKey, 'hex'),
      name: data.name || 'anon',
      dir
    }
  }

  // First run – create identity
  const kp = generateKeypair()
  const name = opts.name || 'anon'

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(idPath, JSON.stringify({
    publicKey: b4a.toString(kp.publicKey, 'hex'),
    secretKey: b4a.toString(kp.secretKey, 'hex'),
    name
  }, null, 2))

  return { publicKey: kp.publicKey, secretKey: kp.secretKey, name, dir }
}

/**
 * Update the display name stored in the identity file.
 */
export function setName (name, dir) {
  dir = dir || NEET_DIR
  const idPath = path.join(dir, 'identity.json')
  const data = JSON.parse(fs.readFileSync(idPath, 'utf-8'))
  data.name = name
  fs.writeFileSync(idPath, JSON.stringify(data, null, 2))
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
