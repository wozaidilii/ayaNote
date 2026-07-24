# AyaNote / アヤノート

AI-assisted lesson memory and prep for Japanese 1v1 teachers — with a lite student portal.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- next-intl (日本語 / English)
- Prisma + **Neon Postgres** (required on Vercel; SQLite will not work on serverless)
- Vercel AI SDK (default **DeepSeek**, optional OpenAI)

## Quick start (local)

```bash
npm install
vercel link --yes --scope wozaidiliis-projects --project aya-note
vercel env pull .env.local --yes
# Prisma CLI reads DATABASE_URL from .env — copy from .env.local if needed
cp .env.local .env   # or export DATABASE_URL=...
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Vercel + Prisma

Vercel’s filesystem is ephemeral/read-only, so `file:./dev.db` fails with `SQLITE_CANTOPEN`.

This project is wired to Neon:

1. Marketplace resource: `ayanote-db` (Neon)
2. Env: `DATABASE_URL` / `POSTGRES_*` injected on the `aya-note` project
3. Client: `@prisma/adapter-neon` + `@neondatabase/serverless`
4. Build runs `prisma generate && prisma db push && next build`

Dashboard: [aya-note on Vercel](https://vercel.com/wozaidiliis-projects/aya-note)

## Demo accounts

| Role | Entry |
|------|--------|
| Teacher (Ayano) | Landing → teacher CTA |
| Student (Alex) | Landing → student CTA |

## Env

See `.env.example`. Never commit `.env` / `.env.local`.

AI (default DeepSeek):

```bash
AYANOTE_AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
# AYANOTE_MODEL=deepseek-chat

# or switch:
# AYANOTE_AI_PROVIDER=openai
# OPENAI_API_KEY=sk-...
```
