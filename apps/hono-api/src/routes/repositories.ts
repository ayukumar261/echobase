import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import { decrypt } from '../lib/crypto.js'
import { getDb } from '../lib/db.js'
import { GithubAuthError, getRepositories } from '../lib/github.js'

export const repositoriesRoutes = new Hono()

repositoriesRoutes.get('/', async (c) => {
  const userId = getCookie(c, 'user_id')
  if (!userId) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb()
  const row = await db
    .selectFrom('users')
    .where('id', '=', userId)
    .select(['access_token'])
    .executeTakeFirst()

  if (!row) return c.json({ error: 'unauthenticated' }, 401)

  const token = decrypt(row.access_token)

  try {
    const repositories = await getRepositories(token)
    return c.json({ repositories })
  } catch (err) {
    // Token revoked at the GitHub side — surface as 401 so the client can
    // route the user back through /connect.
    if (err instanceof GithubAuthError) {
      return c.json({ error: 'github_unauthorized' }, 401)
    }
    throw err
  }
})
