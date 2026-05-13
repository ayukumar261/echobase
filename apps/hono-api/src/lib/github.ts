/**
 * Thin typed wrappers over the GitHub OAuth + user APIs. Kept dependency-free
 * (just `fetch`) so the route handler stays easy to read.
 */

export interface GithubTokenResponse {
  access_token: string
  scope: string
  token_type: string
}

export interface GithubUser {
  id: number
  login: string
  name: string | null
  avatar_url: string | null
  email: string | null
}

interface GithubEmail {
  email: string
  primary: boolean
  verified: boolean
}

const UA = 'echobase-hono-api'

export async function exchangeCodeForToken(params: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<GithubTokenResponse> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
  })
  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`)
  }
  const body = (await res.json()) as Partial<GithubTokenResponse> & {
    error?: string
    error_description?: string
  }
  if (body.error || !body.access_token) {
    throw new Error(`GitHub token exchange error: ${body.error_description ?? body.error ?? 'unknown'}`)
  }
  return body as GithubTokenResponse
}

export async function fetchGithubUser(token: string): Promise<GithubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
    },
  })
  if (!res.ok) throw new Error(`GitHub /user failed: ${res.status}`)
  return (await res.json()) as GithubUser
}

export interface GithubRepository {
  id: number
  name: string
  full_name: string
  private: boolean
  default_branch: string
  pushed_at: string | null
  owner: { login: string; avatar_url: string }
}

/**
 * `Link: <…?page=2>; rel="next", <…?page=N>; rel="last"` — parse out just the
 * `next` URL so we can follow pagination without pulling in a parser dep.
 */
function parseNextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1] ?? null
  }
  return null
}

/**
 * List every repository the authenticated user has access to (owned, collaborator,
 * or via org membership), sorted by recently pushed. Follows GitHub's `Link`
 * pagination so callers get the complete set in one call.
 *
 * Throws `GithubAuthError` if the token has been revoked so route handlers can
 * surface a 401 to the client.
 */
export class GithubAuthError extends Error {
  constructor() {
    super('GitHub token unauthorized')
    this.name = 'GithubAuthError'
  }
}

export async function getRepositories(token: string): Promise<GithubRepository[]> {
  const out: GithubRepository[] = []
  let url: string | null =
    'https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'

  while (url) {
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': UA,
      },
    })
    if (res.status === 401) throw new GithubAuthError()
    if (!res.ok) {
      throw new Error(`GitHub /user/repos failed: ${res.status}`)
    }
    const page = (await res.json()) as GithubRepository[]
    for (const r of page) {
      out.push({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
        pushed_at: r.pushed_at,
        owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
      })
    }
    url = parseNextLink(res.headers.get('link'))
  }
  return out
}

export async function fetchPrimaryEmail(token: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': UA,
    },
  })
  if (!res.ok) return null
  const emails = (await res.json()) as GithubEmail[]
  return emails.find((e) => e.primary && e.verified)?.email ?? null
}
