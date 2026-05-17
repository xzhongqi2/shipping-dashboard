# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server (HMR)
- `npm run build` — production build to `dist/`
- `npm run lint` — ESLint over `**/*.{js,jsx}` (config in `eslint.config.js`)
- `npm run preview` — serve the built `dist/` locally

No test framework is configured.

## Architecture

This is a small Chinese-language ("海运拼箱 Dashboard") React 19 + Vite + Tailwind v4 app for tracking shipping container load/weight/revenue rates across five fixed US-bound container routes.

The whole UI lives in `src/App.jsx` as a flat set of components (`InputForm`, `RecordList`, `Summary`, `ContainerCard`, `RateBadge`, plus an unused `Auth`). State is local to `App` — there is no router, no context, no global store.

Two pieces of domain config drive everything:

- `CONTAINERS` (top of `App.jsx`) — the five routes (美西/美中南/美中北/美东南/美东北), each with `capacityCBM`, `capacityKG`, `cost`. Adding/renaming a route here also requires updating the `container` CHECK constraint in `supabase-schema.sql`, otherwise inserts will be rejected.
- `EMPTY_STATE` — derived from `CONTAINERS`, holds the per-container running totals.

Data flow: `InputForm` → `handleSubmit` in `App` → appends to `records` and adds to `state[container]` totals. `handleDelete` subtracts; `handleUpdate` rebuilds the entire `state` aggregate by re-reducing `records` (the source of truth for totals is the records list, not `state`). Records are kept in memory only — nothing is persisted.

### Auth and Supabase divergence

There is a real mismatch in this repo to be aware of before touching auth or persistence:

- `supabase-schema.sql` defines a `records` table with RLS keyed on `auth.uid() = user_id` — i.e., the schema assumes every user is logged in.
- `src/lib/supabase.js` exists and exports a configured client.
- The `Auth` component in `App.jsx` is defined but **not rendered**; the most recent commit ("Remove login: show dashboard directly") removed login from the render path, so the app currently runs with no auth and no DB calls. `Auth` also references `supabase` without importing it — it would crash if mounted.

If you're asked to wire persistence back up, either re-introduce auth and fix the missing import, or change the schema (drop RLS / `user_id`) to match the no-login UI. Don't add Supabase calls to the dashboard path while RLS still requires `auth.uid()` — inserts will silently fail.

### Secrets

`src/lib/supabase.js` currently hardcodes the Supabase URL and publishable key. `.env.example` and `DEPLOYMENT_GUIDE.md` describe a `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env-var setup that the code does not actually read — prefer migrating to `import.meta.env.*` rather than editing the hardcoded values.
