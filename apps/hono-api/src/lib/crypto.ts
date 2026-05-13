import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Symmetric encryption for at-rest secrets (e.g. GitHub access tokens).
 *
 * Format: `base64(iv).base64(ciphertext).base64(authTag)` — each component
 * separately base64-encoded so the joined string contains no `=` padding
 * collisions on the `.` separator.
 *
 * The key is read once at module load; we fail fast if it's missing or the
 * wrong length so a misconfigured deploy can't silently write tokens we'll
 * later be unable to decrypt.
 */
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // GCM standard
const KEY_BYTES = 32

function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    )
  }
  return key
}

const KEY = loadKey()

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, KEY, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), ct.toString('base64'), tag.toString('base64')].join('.')
}

export function decrypt(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext payload')
  }
  const [ivB64, ctB64, tagB64] = parts as [string, string, string]
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ])
  return pt.toString('utf8')
}
