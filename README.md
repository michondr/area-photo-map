# area-photo-map

Photos from a Google Photos album pinned on a map of our house and garden, organized
into named areas. The living spec is [SPEC.md](SPEC.md).

## Dev

    cp .env.example .env    # fill POSTGRES_PASSWORD (also set it in DATABASE_URL)
    docker compose up -d db
    npm install
    npm run dev             # API on :3001, vite UI on :5173

## Prod (behind Traefik)

    docker compose up -d --build

Set `APP_DOMAIN` in `.env`; adjust the Traefik entrypoint/cert-resolver labels in
`docker-compose.yml` if your proxy names them differently.