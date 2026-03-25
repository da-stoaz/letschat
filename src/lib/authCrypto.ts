import type { AuthCredential } from '../types/domain'

const PBKDF2_ITERATIONS = 210_000
const PBKDF2_HASH = 'SHA-256'
const SALT_BYTES = 16
const IV_BYTES = 12

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes)
  return copy.buffer
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytes
}

async function derivePasswordSecret(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password)
  const passwordKey = await crypto.subtle.importKey('raw', toArrayBuffer(passwordBytes), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: PBKDF2_HASH, salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS },
    passwordKey,
    256,
  )
  return new Uint8Array(bits)
}

async function importAesKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(secret), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export type EncryptedCredentialPayload = {
  passwordSalt: string
  passwordHash: string
  tokenIv: string
  tokenCipher: string
}

export async function encryptTokenForCredential(password: string, token: string): Promise<EncryptedCredentialPayload> {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const secret = await derivePasswordSecret(password, salt)
  const key = await importAesKey(secret)

  const tokenBytes = new TextEncoder().encode(token)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(tokenBytes),
  )
  const cipher = new Uint8Array(cipherBuffer)

  return {
    passwordSalt: toBase64(salt),
    passwordHash: toBase64(secret),
    tokenIv: toBase64(iv),
    tokenCipher: toBase64(cipher),
  }
}

export async function decryptTokenFromCredential(password: string, credential: AuthCredential): Promise<string | null> {
  try {
    const salt = fromBase64(credential.passwordSalt)
    const secret = await derivePasswordSecret(password, salt)
    const expectedHash = toBase64(secret)
    if (expectedHash !== credential.passwordHash) {
      return null
    }

    const key = await importAesKey(secret)
    const iv = fromBase64(credential.tokenIv)
    const cipher = fromBase64(credential.tokenCipher)
    const clearBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(cipher))
    return new TextDecoder().decode(clearBuffer)
  } catch {
    return null
  }
}
