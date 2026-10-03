import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from './db.js'
import { migrate } from './migrate.js'

const port = Number(process.env.PORT ?? 3000)
const imagesDir = process.env.IMAGES_DIR ?? path.join(import.meta.dirname, 'images')

const app = new Hono()

app.get('/api/health', async (c) => {
  const rows = await sql`SELECT postgis_version() AS postgis`
  return c.json({ ok: true, postgis: rows[0]?.postgis ?? null })
})

// derivatives are content-immutable: served with a permanent cache header
const KINDS = { thumb: 'thumbs', preview: 'previews', original: 'originals' } as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

app.get('/images/:kind/:id', async (c) => {
  const kind = c.req.param('kind') as keyof typeof KINDS
  const id = c.req.param('id')
  if (!(kind in KINDS) || !UUID_RE.test(id)) return c.text('not found', 404)

  const file = path.join(imagesDir, KINDS[kind], `${id}.jpg`)
  try {
    const data = await readFile(file)
    c.header('Content-Type', 'image/jpeg')
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    return c.body(data)
  } catch {
    return c.text('not found', 404)
  }
})

// built SPA (production); in dev vite serves the UI and this 404s harmlessly
app.use('/*', serveStatic({ root: './public' }))
app.get(
  '*',
  serveStatic({
    root: './public',
    rewriteRequestPath: () => '/index.html',
  }),
)

await migrate()
for (const dir of Object.values(KINDS)) {
  await mkdir(path.join(imagesDir, dir), { recursive: true })
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`area-photo-map listening on http://localhost:${info.port}`)
})

process.on('SIGTERM', () => {
  void sql.end({ timeout: 1 }).then(() => process.exit(0))
})