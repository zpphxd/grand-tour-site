# A Year from Zürich

A photo-first travel site for a year of Europe's defining cultural events (Aug 2026 – Aug 2027), planned from a home base in Zürich.

- **The Map** — three multi-leg journeys drawn on an interactive Europe map (SVG, no dependencies)
- **Calendar** — editorial month cards plus a wall-calendar grid with real event date spans
- **Build a Route** — compose your own itinerary; distance, mode and rough cost update live
- **26 event dossiers** — history, logistics from Zürich, costs, tips, local picks, booking links and Wikimedia Commons photography (`data/events/*.json`)

## Run locally

Static site, no build step:

```sh
python3 -m http.server 4173
# open http://localhost:4173
```

## Publish

Deploys as-is to any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages). No environment variables, no server.

Photos hotlink from `upload.wikimedia.org` under their respective free licenses; credits appear with each image. Verify event dates and prices on official sites before booking.
