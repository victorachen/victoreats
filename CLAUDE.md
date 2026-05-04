# VictorEats — Food Blog

Personal food blog at **victoreats.com**, built with Hugo + GitHub Pages.

## Architecture
- **Hugo** static site generator with **Ananke** theme (git submodule, not modified)
- Custom layouts override Ananke in `layouts/` (not `themes/ananke/layouts/`)
- **Leaflet + OpenStreetMap** for interactive map (free, no API key)
- GitHub Actions auto-deploys on push to `main`

## Domain
- **victoreats.com** — purchased on Namecheap (Apr 17, 2026), expires Apr 18, 2027
- Namecheap account username: `victoreats`
- DNS: 4 A records pointing to GitHub Pages IPs (185.199.108-111.153) + CNAME `www` → `victorachen.github.io.`
- SSL cert provisioned by GitHub Pages (auto, may take 30 min after DNS changes)

## Site Layout — Four Tabs
1. **Serious Eats** (default): Cards for posts with `serious: true` in front matter
2. **Not So Serious Eats**: Cards for all other posts (default category)
3. **Search**: Keyword search (titles, addresses, reviews), radius from address (Nominatim geocoder), and "How Serious Are We?" filter
4. **Map**: Leaflet map — red pins = serious eats, blue pins = not so serious. Checkbox toggle "We are taking this very seriously" hides blue pins

## Key Files
- `hugo.toml` — Site config. `[outputs] home = ["HTML", "RSS", "JSON"]` enables `/index.json` for map data
- `layouts/home.html` — Main page with list/map tabs (overrides Ananke)
- `layouts/index.json` — Hugo template generating JSON array of all restaurants (consumed by map JS)
- `layouts/partials/head-additions.html` — Leaflet CDN + custom CSS
- `static/js/app.js` — Tab switching, Leaflet map, search, inline edit/delete via Cloudflare Worker
- `layouts/_partials/tags.html` — Overrides Ananke's tags partial (hidden, tags removed from site)
- `static/images/` — Restaurant photos (committed by Telegram bot)
- `static/CNAME` — Domain config for GitHub Pages
- `content/posts/` — Blog posts as markdown with front matter
- `scripts/backfill_coords.py` — Backfills missing/zero lat,lng on existing posts (Nominatim → Photon fallback). Uses stdlib only, no deps.
- `.github/workflows/backfill-coords.yml` — Daily cron (`0 12 * * *` UTC = 5am Pacific) running the backfill script; also `workflow_dispatch`

## Post Front Matter Format
```yaml
title: "Restaurant Name"
date: 2026-04-17
draft: false
address: "123 Main St, City, CA 12345"
lat: 37.4323
lng: -121.8996
image: "/images/slug.jpg"
serious: false
```
- `serious: true` puts the post in the "Serious Eats" tab; `false` (or absent) puts it in "Not So Serious Eats"
- `tags` field is no longer used (removed from display, edit flow, and templates)
- Posts without lat/lng still appear in list tabs, just not on the map or in radius search

## Inline Editing (Edit/Delete from the Site)
- Each card has an **Edit** button → modal opens immediately (no passcode, no auth) → save/delete via Cloudflare Worker proxy
- **Truly open auth model** — anyone who finds the site can edit or delete any post. Trade-off accepted (May 1, 2026) to eliminate per-browser token setup.
- Save/Delete commit changes to the repo via the worker → GitHub API, triggering Pages auto-deploy (~1 min)
- All edit/delete logic lives in `static/js/app.js`; only constant is `WORKER` (the worker URL)

## Cloudflare Worker Proxy (DEPLOYED — May 1, 2026)
- **URL:** `https://victoreats-edit.vchen2120.workers.dev`
- **Cloudflare account:** signed in via GitHub OAuth as `vchen2120@gmail.com`'s account; workers subdomain is `vchen2120.workers.dev`
- **Worker code lives in the Cloudflare dashboard, NOT in this repo.** To edit: dash.cloudflare.com → Workers & Pages → `victoreats-edit` → Edit code. (If a future change needs version control, switch to wrangler + commit to a separate repo or this one's `cloudflare/` dir.)
- **What it does:** receives requests at `/contents/<path>`, forwards to `https://api.github.com/repos/victorachen/victoreats/contents/<path>` with the GitHub PAT in an `Authorization` header, returns the response with permissive CORS (`Access-Control-Allow-Origin: *`). Supports GET/PUT/DELETE/OPTIONS.
- **Secret:** `GITHUB_TOKEN` env var (Cloudflare → worker → Settings → Variables and Secrets) holds a fine-grained GitHub PAT scoped to `victorachen/victoreats` with **Contents: Read and write**. If edits start failing silently, the PAT likely expired — regenerate at github.com/settings/personal-access-tokens and update the secret.
- **No auth on the worker itself** — anyone hitting the URL can edit/delete posts. If abuse becomes a problem, add a shared-secret header check in the worker (request must include `X-Edit-Secret: <value>`, value also stored as a Cloudflare secret) and have `app.js` send it.

### How to create a worker like this in Cloudflare's UI (gotcha)
- Workers & Pages → Create application → Create Worker → "Ship something new" screen offers: **Continue with GitHub**, Connect GitLab, **Start with Hello World!**, Select a template, Upload your static files.
- **Pick "Start with Hello World!"** — this gives you a placeholder worker you can paste arbitrary code into. "Continue with GitHub" is for *deploying a worker from a repo* (auto-builds on push) which is overkill here and adds repo-connection complexity. We picked "Continue with GitHub" first by mistake and had to back out.

## Telegram Bot Integration
Posts are created automatically by the `victoreats_bot` (separate repo/service). The bot commits photos to `static/images/` and markdown posts to `content/posts/` via GitHub API, triggering auto-deploy.

## Geocoding & Coord Backfill (May 2026)
Three-layer resilience so a Nominatim hiccup never blocks a post:

1. **Bot-time geocoding** (`victoreats_bot/geocode.py`): Nominatim with 3 retries (1s/2s/4s backoff), then Photon (`photon.komoot.io/api/`), then the **US Census Geocoder** (`geocoding.geo.census.gov`, TIGER data, US-only). Census catches rural/farm addresses where OSM has gaps — e.g. "501 Hoffman Ln, Brentwood CA 94513" returns 0 results from both Nominatim and Photon (May 4 2026, Very Berry Mulberry post) but resolves cleanly via Census.
2. **Bot posts anyway on total failure**: if all providers fail, the bot writes the post with `lat: 0, lng: 0` and replies with a "geocoding failed, posted without map pin" warning. Previously the bot rejected the post entirely (the failure mode that prompted this work — Tony's Pizza Napoletana, May 2 2026).
3. **Daily backfill workflow** (`.github/workflows/backfill-coords.yml`): scans `content/posts/*.md` for missing or `~0` coords, geocodes (Nominatim → Photon → Census), commits any updates. Runs at 12:00 UTC daily; can also trigger manually via `workflow_dispatch`.

Coord-aware site behavior (already in place, do not break):
- `app.js:60` — map skips pins where `lat && lng` is falsy (so `0,0` posts are silently omitted)
- `app.js:209` — radius search skips coordless cards
- `app.js:302` — edit-save re-geocodes whenever coords are missing or address changed (commit `7d261f2`)

### Gotcha — Photon GeoJSON ordering
Photon returns `features[0].geometry.coordinates` as `[lng, lat]` (GeoJSON standard), opposite of Nominatim's `lat`/`lon` keys. Both `geocode.py` (bot) and `backfill_coords.py` unpack as `lng, lat = coordinates` — don't flip this.

### Backfill script details
- No external deps (stdlib `urllib`/`json`/`re`) so it runs on a vanilla Actions Python step.
- Front-matter parse is regex-based to preserve existing formatting; `upsert_field` either replaces an existing line or appends to the end of the front-matter block.
- Sleeps 1.1s between geocoding requests (Nominatim's 1 req/sec policy).
- `python scripts/backfill_coords.py --dry-run` reports what would change without writing — useful for sanity-checking after edits.

## GitHub
- **Repo:** `victorachen/victoreats` (public)
- **GitHub Pages:** Deployed via Actions workflow (`.github/workflows/deploy.yml`)
- Hugo version: 0.160.1 (extended)

## Gotchas
- Leaflet map must be lazily initialized (only when Map tab is visible) or tiles render incorrectly
- Hugo JSON output requires `[outputs] home = ["HTML", "RSS", "JSON"]` in config
- DNS propagation + SSL cert provisioning can take up to 30 min after changes
- Hugo's `jsonify` in `<script>` blocks gets HTML-escaped by Go templates — pipe through `| safeJS` to prevent double-quoting (e.g. `{{ .Title | jsonify | safeJS }}`)
- When removing UI fields from the edit modal, must also remove corresponding `document.getElementById()` calls in JS — otherwise the function throws and silently fails
- GitHub secret scanning detects PATs even when base64-encoded — cannot embed tokens in any form in a public repo
- The victoreats_bot pushes posts via GitHub API, so local clone may be behind remote — always `git pull` before building locally
- Colored map markers use [leaflet-color-markers](https://github.com/pointhi/leaflet-color-markers) PNGs via CDN
- Map popup reviews from `index.json` may contain `&amp;` entities — clean with `.replace(/&amp;/g, '&')` before rendering in popup HTML
- Map popups include address + "Copy" button (uses `navigator.clipboard.writeText`)
- HTTPS enforcement may not be available immediately — GitHub Pages needs to provision the SSL cert first. Check at Settings → Pages → "Enforce HTTPS". Until then, `http://` shows "Not Secure"
- Remote frequently has commits from the victoreats_bot — expect `git pull --rebase` before almost every push
