# what's playing near you

Toronto independent cinema showtimes, sorted by distance. A static HTML page that auto-updates via GitHub Actions — no backend, no database.

**Live site:** https://orangeccw.github.io/whats-playing-to/

## How it works

1. **GitHub Actions** runs a Node.js crawler 3 times a week (Tue/Thu/Sat at 6 AM Toronto time)
2. The crawler scrapes showtime data from 8 cinema websites
3. Posters and metadata are enriched via OMDb API (with TMDB as optional fallback)
4. Updated data is committed to `data/showtimes.json`
5. GitHub Pages serves the static `index.html`, which fetches the JSON on page load

## Cinemas (8)

| Cinema | Scraper method | Poster source |
|--------|---------------|---------------|
| Fox Theatre | WordPress REST API | Yoast OG image from API |
| Revue Cinema | HTML (`.movie-card` containers) | `<img data-src>` lazy-loaded |
| Paradise Theatre | HTML (`div.show` + CSS variable) | `--show-background-image` CSS var |
| Hot Docs Cinema | JSON-LD structured data | agileticketing.net CDN |
| Imagine Cinemas Carlton | HTML (standard markup) | `<img>` tag |
| TIFF Lightbox | Puppeteer (JS-rendered SPA) | `background-image` in card div |
| Kingsway Theatre | HTML (image alt attributes) | `<img src>` |
| CineCycle | HTML (plain text parsing) | None — OMDb only |

TIFF is listed as "titles only" on the site (showtimes require clicking through to tiff.net).

## Project structure

```
├── index.html              # Static page (fetches data/showtimes.json)
├── data/
│   └── showtimes.json      # Crawler-generated showtime data
├── crawler/
│   ├── package.json
│   └── scrape.js           # Node.js crawler (axios + cheerio + puppeteer)
└── .github/workflows/
    └── crawl.yml           # Scheduled crawl (Tue/Thu/Sat) + auto-commit
```

## Setup

1. GitHub Pages enabled: Settings > Pages > Source: Deploy from a branch > `main` > `/(root)`
2. Workflow permissions: Settings > Actions > General > Workflow permissions > Read and write permissions

## Manual crawl

Go to Actions tab > "Crawl Showtimes" > "Run workflow"

## API enrichment (posters + metadata)

The crawler extracts posters from cinema websites first. For any movies still missing posters, it falls back to OMDb (and TMDB if configured). Without any API keys, the crawler still works — missing posters show a gradient placeholder.

### OMDb (recommended)

1. Register at https://www.omdbapi.com/apikey.aspx (free, just needs email)
2. Get your API key by email
3. Add as GitHub secret: Settings > Secrets and variables > Actions > Repository secrets
   - Name: `OMDB_API_KEY`
   - Value: your key

### TMDB (optional, more comprehensive)

1. Register at https://www.themoviedb.org/settings/api (free)
2. Get your API Key (v3 auth)
3. Add as GitHub secret: Name `TMDB_API_KEY`, Value your key

Both can be used simultaneously — TMDB runs first, OMDb fills remaining gaps.

## Features

- **Day/Night theme** — auto-follows system, manual toggle, remembers choice
- **Geolocation sorting** — finds your location, sorts by nearest cinema
- **Distance color coding** — green (<1km) to red (>3km)
- **Date filters** — today / tomorrow / this week
- **Genre filter** — dropdown with removable tags
- **Cinema filter** — multi-select checkboxes
- **Favorites** — heart icon, saved in localStorage
- **Only available** — hides sold-out and past showtimes
- **Search** — filter by title, description, or director
- **Responsive** — optimized for both desktop and mobile
