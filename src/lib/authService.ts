import type { Identity } from '../types/domain'

const AUTH_SERVICE_URL = (import.meta.env.VITE_AUTH_SERVICE_URL as string | undefined) ?? 'http://127.0.0.1:8787'
const AUTH_SESSION_KEY = 'letschat.auth_session_token'

export interface AuthFrameworkToken {
  token_id: string
  user_id: string
  access_token: string
  token_type?: string | null
  subject?: string | null
  issuer?: string | null
  refresh_token?: string | null
  issued_at: string
  expires_at: string
  scopes: string[]
  auth_method: string
  client_id?: string | null
  user_profile?: unknown
  permissions: string[]
  roles: string[]
  metadata: Record<string, unknown>
}

export interface AuthServiceResponse {
  username: string
  displayName: string
  spacetimeToken: string
  spacetimeIdentity: Identity
  sessionToken: AuthFrameworkToken
}

type RegisterPayload = {
  username: string
  displayName: string
  password: string
  spacetimeToken: string
  spacetimeIdentity: Identity
}

type LinkPayload = {
  username: string
  displayName: string
  password: string
  spacetimeToken: string
  spacetimeIdentity: Identity
}

type LoginPayload = {
  username: string
  password: string
}

async function postJson<TResponse, TPayload extends Record<string, unknown>>(
  path: string,
  payload: TPayload,
): Promise<TResponse> {
  const response = await fetch(`${AUTH_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const fallback = `Request failed (${response.status})`
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? fallback)
  }

  return (await response.json()) as TResponse
}

export async function authServiceRegister(payload: RegisterPayload): Promise<AuthServiceResponse> {
  const result = await postJson<AuthServiceResponse, RegisterPayload>('/auth/register', payload)
  setStoredAuthSessionToken(result.sessionToken)
  return result
}

export async function authServiceLink(payload: LinkPayload): Promise<AuthServiceResponse> {
  const result = await postJson<AuthServiceResponse, LinkPayload>('/auth/link', payload)
  setStoredAuthSessionToken(result.sessionToken)
  return result
}

export async function authServiceLogin(payload: LoginPayload): Promise<AuthServiceResponse> {
  const result = await postJson<AuthServiceResponse, LoginPayload>('/auth/login', payload)
  setStoredAuthSessionToken(result.sessionToken)
  return result
}

export async function authServiceVerify(): Promise<boolean> {
  const token = getStoredAuthSessionToken()
  if (!token) return false

  const result = await postJson<{ valid: boolean }, { sessionToken: AuthFrameworkToken }>('/auth/verify', {
    sessionToken: token,
  })
  return Boolean(result.valid)
}

export function getStoredAuthSessionToken(): AuthFrameworkToken | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthFrameworkToken
  } catch {
    return null
  }
}

export function setStoredAuthSessionToken(token: AuthFrameworkToken): void {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(token))
}

export function clearStoredAuthSessionToken(): void {
  localStorage.removeItem(AUTH_SESSION_KEY)
}
