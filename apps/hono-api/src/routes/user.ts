import { randomBytes } from 'node:crypto'

import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { encrypt } from '../lib/crypto.js'
import { getDb } from '../lib/db.js'
import {
  exchangeCodeForToken,
  fetchGithubUser,
  fetchPrimaryEmail,
} from '../lib/github.js'

const STATE_COOKIE = 'gh_oauth_state'
const REQUIRED_SCOPE = 'repo'
const SCOPES = ['repo', 'read:user', 'user:email'].join(' ')

function publicApiUrl(): string {
  return process.env.PUBLIC_API_URL ?? 'http://localhost:3001'
}

function publicWebUrl(): string {
  return process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000'
}

function redirectUri(): string {
  return `${publicApiUrl()}/api/user/callback/github`
}

export const userRoutes = new Hono()

userRoutes.get('/login/github', (c) => {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) return c.text('GITHUB_CLIENT_ID not configured', 500)

  const state = randomBytes(16).toString('hex')
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })

  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('state', state)
  return c.redirect(url.toString(), 302)
})

userRoutes.get('/callback/github', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const cookieState = getCookie(c, STATE_COOKIE)
  deleteCookie(c, STATE_COOKIE, { path: '/' })

  if (!code || !state || !cookieState || state !== cookieState) {
    return c.text('Invalid OAuth state', 400)
  }

  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.text('GitHub OAuth not configured', 500)
  }

  const token = await exchangeCodeForToken({
    clientId,
    clientSecret,
    code,
    redirectUri: redirectUri(),
  })

  // Reject if the user de-selected `repo` on the consent screen — E2B push to
  // private repos won't work without it, so persisting that token is useless.
  const grantedScopes = token.scope.split(/[,\s]+/).filter(Boolean)
  if (!grantedScopes.includes(REQUIRED_SCOPE)) {
    return c.text(`Missing required scope: ${REQUIRED_SCOPE}`, 400)
  }

  const profile = await fetchGithubUser(token.access_token)
  const email = profile.email ?? (await fetchPrimaryEmail(token.access_token))

  const encryptedToken = encrypt(token.access_token)
  const now = new Date()

  const db = getDb()
  const row = await db
    .insertInto('users')
    .values({
      github_id: String(profile.id),
      github_login: profile.login,
      email,
      name: profile.name,
      avatar_url: profile.avatar_url,
      access_token: encryptedToken,
      token_scopes: grantedScopes,
      refresh_token: null,
      token_expires_at: null,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('github_id').doUpdateSet({
        github_login: (eb) => eb.ref('excluded.github_login'),
        email: (eb) => eb.ref('excluded.email'),
        name: (eb) => eb.ref('excluded.name'),
        avatar_url: (eb) => eb.ref('excluded.avatar_url'),
        access_token: (eb) => eb.ref('excluded.access_token'),
        token_scopes: (eb) => eb.ref('excluded.token_scopes'),
        updated_at: now,
      }),
    )
    .returning(['id'])
    .executeTakeFirstOrThrow()

  // Minimal session cookie — a real signed JWT is out of scope for this ticket.
  setCookie(c, 'user_id', row.id, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })

  return c.redirect(`${publicWebUrl()}/?login=ok`, 302)
})

userRoutes.get('/me', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb()
  const row = await db
    .selectFrom('users')
    .where('id', '=', userId)
    .select(['id', 'github_id', 'github_login', 'email', 'name', 'avatar_url'])
    .executeTakeFirst()

  if (!row) {
    // Stale cookie pointing at a deleted user — clear it so the client recovers.
    deleteCookie(c, 'user_id', { path: '/' })
    return c.json({ error: 'unauthenticated' }, 401)
  }

  return c.json(row)
})

userRoutes.post('/logout', (c) => {
  deleteCookie(c, 'user_id', { path: '/' })
  return c.body(null, 204)
})
