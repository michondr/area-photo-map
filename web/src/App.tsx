import { useEffect, useState } from 'react'

type Health = { ok: boolean; postgis: string | null }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)))
  }, [])

  return (
    <main style={{ padding: 16 }}>
      <h1>area-photo-map</h1>
      {error && <p>API error: {error}</p>}
      {health && <p>API ok — PostGIS {health.postgis}</p>}
    </main>
  )
}