import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { repositoriesRoutes } from './routes/repositories.js'
import { sessionsRoutes } from './routes/sessions.js'
import { tasksRoutes } from './routes/tasks.js'
import { userRoutes } from './routes/user.js'

const app = new Hono()

app.use(
  '/api/*',
  cors({
    origin: process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  }),
)

app.get('/', (c) => c.text('Hello from Hono!'))
app.get('/health', (c) => c.json({ status: 'ok' }))

// More-specific prefix first so /api/user/repositories doesn't fall through
// to userRoutes' 404 handler.
app.route('/api/user/repositories', repositoriesRoutes)
app.route('/api/user', userRoutes)
app.route('/api/sessions', sessionsRoutes)
app.route('/api/tasks', tasksRoutes)

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`)
})
