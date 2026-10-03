import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sql } from './db.js'

// migrations are plain SQL, applied in filename order, once each.
// note: statement splitting below assumes no ';' inside string literals or functions.
const migrationsDir =
  process.env.MIGRATIONS_DIR ?? path.join(import.meta.dirname, 'migrations')

export async function migrate(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`

  const applied = new Set(
    (await sql`SELECT name FROM _migrations`).map((row) => row.name),
  )

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const contents = await readFile(path.join(migrationsDir, file), 'utf8')
    const statements = contents
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement)
      }
      await tx`INSERT INTO _migrations (name) VALUES (${file})`
    })
    console.log(`applied migration ${file}`)
  }
}