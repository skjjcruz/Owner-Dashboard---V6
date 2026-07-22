# Owner-Dashboard---V6 — Dynasty HQ (web-only)

The **web-only** Dynasty HQ app, served on GitHub Pages at
**https://www.dhqfootball.com/** (custom domain, site at the domain root).

This repo is a lean extraction of the original combined repo
(`skjjcruz/github.com-skjjcruz-owner-dashboard-dev`, which doubles as the iOS
Capacitor bundle). Everything native was stripped: no Capacitor, no
RevenueCat, no `capacitor.config.json`, no `supabase/` tree. The iOS app
continues to live in the dev repo.

## Backend — frontend-only rule

The backend is the **shared Supabase project**
`https://sxshiqyxhhifvtfqawbq.supabase.co`. This repo only *calls* the
existing edge functions (`fw-signin`, `fw-create-checkout`,
`fw-billing-portal`, `ai-analyze`, …).

**Never deploy edge functions or database migrations from this repo.** The
`supabase/` sources (functions + migrations) stay with the dev repo, which
owns backend deploys.

## Billing

- **Web (this repo):** Stripe. `upgrade.html` creates a checkout session via
  the `fw-create-checkout` edge function; "Manage Subscription" (Settings and
  `upgrade.html` when already Pro) opens the Stripe Billing Portal via
  `fw-billing-portal`.
- **iOS:** Apple In-App Purchase via RevenueCat — handled entirely in the iOS
  app repo; its webhook writes the same `public.subscriptions` rows the
  Stripe webhook writes.
- **Entitlements are unified server-side** in the `subscriptions` table: a
  user who subscribed on either platform is Pro everywhere. The client reads
  the tier from the `fw_session_v1` JWT (re-minted by `fw-refresh-session`).
- `js/billing.js` here is a web-only shim that keeps the `window.DHQBilling`
  API surface (`available()` is always `false`; purchase paths route to
  Stripe).

## Shared engine vendoring

The canonical shared browser engine lives in `skjjcruz/DHQ-Shared`.
`npm run sync:shared` (`scripts/sync-reconai-shared.cjs`) vendors it into
`reconai-shared/` (gitignored) and refreshes the rookie CSVs in
`draft-war-room/`. Source resolution order:

1. `$DHQ_SHARED_SOURCE` (used by the deploy workflow)
2. `../DHQ-Shared` (sibling checkout)
3. `../dhq-shared` (lowercase fallback)

`js/shared/shared-loader.js` then serves the vendored modules same-origin at
runtime. Its base paths are relative, so they work unchanged at the custom
domain root.

## Local dev

```sh
npm install
npm run dev        # sync:shared + static server on :3001 with JSX compile
npm run dev:raw    # same without the compile step (in-browser Babel)
npm test           # core regression suite (tests/run.js — standalone, no backend)
npx eslint . --ext .js
npm run build:deploy   # what the Pages deploy runs (dist-deploy/ overlay)
npm run preview:prod   # production-style preview on :3002
```

Local AI preview keys go in `.env.local` (see `.env.example`).

## Deploy

GitHub Pages via Actions (`.github/workflows/deploy.yml`), on push to `main`:

1. checkout this repo + `skjjcruz/DHQ-Shared`
2. `npm ci --omit=dev`
3. `DHQ_SHARED_SOURCE=… npm run sync:shared`
4. `node scripts/build-deploy.cjs` (precompiles all JSX, drops in-browser Babel)
5. assemble the Pages artifact (every copied path is existence-checked) and
   deploy with `deploy-pages`

Custom domain: `www.dhqfootball.com` (the `CNAME` file ships in the
artifact). One-time owner setup in GitHub: Settings → Pages → source "GitHub
Actions" + custom domain `www.dhqfootball.com` with "Enforce HTTPS", and a
DNS `CNAME` record pointing `www` at `skjjcruz.github.io`.
