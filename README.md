# AyaNote / アヤノート

AI-assisted lesson memory and prep for Japanese 1v1 teachers — with a lite student portal.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- next-intl (日本語 / English)
- Prisma + SQLite (local MVP)
- Vercel AI SDK (optional `OPENAI_API_KEY`; heuristic fallback without it)

## Quick start

```bash
npm install
npx prisma db push
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo accounts

| Role | Entry |
|------|--------|
| Teacher (Ayano) | Landing → teacher CTA |
| Student (Alex) | Landing → student CTA |

Switch language and role from the sidebar.

## What's in MVP

**Teacher:** Today, Students, Lesson Room (Meet transcript import → summary), Prep Queue, Availability + booking approvals, Settings

**Student lite:** Home (next lesson + progress), Book/Reschedule, History (summaries only)

## Env

Copy `.env.example` → `.env`:

- `DATABASE_URL=file:./dev.db`
- `OPENAI_API_KEY` (optional)
- `AYANOTE_MODEL=gpt-4o-mini`

## PRD

See Notion: AyaNote / アヤノート — Product PRD
