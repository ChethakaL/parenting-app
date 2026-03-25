# Docker (VPS)

The `Dockerfile` builds the Next.js app in `apps/web` using [standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## Prerequisites

1. Copy your production environment file to **`apps/web/.env`** (plain `.env`, not `.env.production`).  
   The image build copies this file into the runtime container. It is **not** in git (see `.gitignore`).
2. From the **repository root**, run:

```bash
docker build -t parenting-web .
docker run --rm -p 3000:3000 parenting-web
```

The app listens on port **3000** inside the container (`HOSTNAME=0.0.0.0`).

## `.dockerignore`

`.env` is **not** listed in `.dockerignore`, so `apps/web/.env` is included in the build context when present.  
Variants such as `.env.production` and `.env.local` are ignored so only the standard file is used, matching the Dockerfile `COPY apps/web/.env` line.

## Reverse proxy

Put Nginx or Caddy in front on the host; set `NEXTAUTH_URL` (and any public URLs) to your HTTPS origin.
