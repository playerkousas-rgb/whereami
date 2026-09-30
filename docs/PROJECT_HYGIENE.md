# Project hygiene & deploy-size policy

This app deploys to Vercel on a metered plan, and it bundles large official
open-data files (`public/data/lampposts/*.json`, `public/data/facilities.json`).
Both of those are legitimate, load-bearing product data — **not** bloat — but
because the repo has a real appetite for growing data files, it is easy for
unrelated bloat to sneak in unnoticed. This document is the permanent checklist
to keep that from happening. Update it whenever the reasoning below changes.

## Ground rules (never violate these)

1. **Never commit build output, dependency trees, or scratch files.**
   `dist/`, `node_modules/`, `*.tsbuildinfo`, `.DS_Store`, `*.bak`, `*.tmp`,
   `*.old`, `*.log` must stay out of git — see `.gitignore`. If you ever find
   one tracked, remove it with `git rm --cached` and add a matching ignore
   pattern instead of a one-off deletion.
2. **Runtime dependencies vs. build tools are not interchangeable.**
   `package.json`'s `dependencies` should only ever list packages that ship in
   the browser bundle or are imported by app code at runtime (currently:
   `leaflet`, `proj4`, `react`, `react-dom`). Everything only needed to build
   or test (`vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `@types/*`)
   belongs in `devDependencies`. Getting this wrong doesn't change what ships
   to the browser (only `dist/` is deployed), but it misrepresents the
   project's real runtime footprint and confuses every future audit — fix it
   immediately if you notice a build tool under `dependencies`.
3. **`.vercelignore` must exist and stay in sync.** Vercel uploads the whole
   repo checkout before running the build command; anything not needed by
   `npm run build` (CI-only scripts, docs, `.github/`) should be excluded so
   deploys stay small and fast. When you add a new top-level file or
   directory, ask: "does `npm run build` read this?" If not, add it to
   `.vercelignore`. If yes (anything under `src/`, `public/`, `index.html`,
   `sw.js`, `package*.json`, `tsconfig*.json`, `vite.config.ts`,
   `vercel.json`), it must **never** be excluded.
4. **`vercel.json` must declare its build explicitly.** Keep
   `"buildCommand": "npm run build"` and `"outputDirectory": "dist"` set so a
   future change to defaults/auto-detection can't silently upload the wrong
   thing or fall back to unexpected behaviour.
5. **Only lampposts and offline basemap tiles are "download on demand."**
   Per the product spec (see `readme`), every other dataset (AED, toilets,
   water stations, fire/ambulance/police/hospitals, distance posts, live
   weather/warnings/closures) ships bundled in `public/data/facilities.json`
   or is fetched live through `/api/live/*`. Do not add a new "download
   separately" data type without updating this rule and the readme, and do
   not quietly turn bundled data into a placeholder/"not available yet"
   message — that regresses a hard product requirement.

## Size budget for `public/data/`

As of this writing the bundled data is ~11 MB total
(`facilities.json` ~1.4 MB, `lampposts/*.json` ~9.4 MB across 19 districts).
That is an accepted, deliberate cost of the "everything except lampposts and
maps ships in the app" requirement above — don't try to shrink it by removing
fields the UI needs (name, address, phone, hours, coordinates). If a future
data source meaningfully grows this (e.g. many more categories), consider:

- Splitting `facilities.json` by type or district the same way lampposts
  already are, so a client only ever needs to fetch what's near it.
- Re-checking whether every field is actually rendered before bundling it.

## Data pipeline correctness matters as much as size

`scripts/build_facilities.py` uses a loose `pick(properties, *needles)` helper
that matches field names by **substring**, not exact key. This is convenient
across the many differently-shaped government GeoJSON schemas it consumes,
but it is also how a real bug shipped: `TRAIL_NAME_TC` matched the `name_tc`
needle before the distance-post-specific fallback ever ran, so every 標距柱
was labelled with its trail name instead of its own post code, and an AED
dataset's truncated `AED_Addres` field wasn't matched by the `address` needle
at all (so a stray `Location_G` value — the latitude — leaked into the
address field instead). When adding a new source or needle:

- Print/inspect a few raw fetched features first; don't assume field names
  from memory or from a similar-looking dataset.
- If a type has its own required identity field (like a distance post's
  code), set `name` for that type explicitly rather than falling through the
  generic multi-needle `pick()` chain — the generic chain is for free-text
  names, not codes that must never be swapped for a category label.
- Re-run `npm run check` and spot-check a handful of built records after any
  pipeline change.

## Pre-deploy checklist

Run before opening a PR or pushing a change that could affect the build or
deploy footprint:

```bash
npm ci
npm run check          # tsc -b && vitest run && vite build
du -sh dist            # sanity-check the output size didn't jump
git ls-files | xargs du -ch | tail -1   # sanity-check tracked repo size
cat .vercelignore      # confirm it still exists and covers new top-level dirs
```

If `dist/` or the tracked repo size grows unexpectedly, find out why before
merging — don't assume it's fine because the build succeeded.
