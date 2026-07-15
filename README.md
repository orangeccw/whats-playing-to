# what's playing near you

Toronto independent cinema showtimes, sorted by distance. A static HTML page that auto-updates daily via GitHub Actions.

**Live site:** https://orangeccw.github.io/whats-playing-to/

## How it works

1. **GitHub Actions** runs a Node.js crawler daily at 6 AM Toronto time
2. The crawler scrapes showtime data from 6 cinema websites
3. Updated data is committed to `data/showtimes.json`
4. GitHub Pages serves the static `index.html`, which fetches the JSON on page load

## Cinemas

- Fox Theatre
- Revue Cinema
- Paradise Theatre
- Hot Docs Cinema
- Imagine Cinemas Carlton
- TIFF Lightbox (titles only — showtimes require JS rendering)

## Project structure

```
├── index.html              # Static page (fetches data/showtimes.json)
├── data/
│   └── showtimes.json      # Crawler-generated showtime data
├── crawler/
│   ├── package.json
│   └── scrape.js           # Node.js crawler
└── .github/workflows/
    └── crawl.yml           # Daily scheduled crawl + auto-commit
```

## Setup (already done)

1. GitHub Pages enabled: Settings > Pages > Source: Deploy from a branch > `main` > `/(root)`
2. Workflow permissions: Settings > Actions > General > Workflow permissions > Read and write permissions

## Manual crawl

Go to Actions tab > "Crawl Showtimes" > "Run workflow"

## Optional: TMDB enrichment (posters + metadata)

The crawler can supplement poster images and metadata (director, year, genres) from [The Movie Database (TMDB)](https://www.themoviedb.org/). Without a key, the crawler still works — it extracts posters from cinema websites directly.

To enable TMDB enrichment:

1. Register at https://www.themoviedb.org/settings/api (free, takes 2 minutes)
2. Get your API Key (v3 auth)
3. Add it as a GitHub secret: Settings > Secrets and variables > Actions > New repository secret
   - Name: `TMDB_API_KEY`
   - Value: your API key

The crawler will automatically use it when the secret is present.

## Features

- **Day/Night theme** — auto-follows system, manual toggle, remembers choice
- **Geolocation sorting** — finds your location, sorts by nearest cinema
- **Distance color coding** — green (<1km) → amber → pink → red (>3km)
- **Date filters** — today / tomorrow / this week
- **Genre & cinema filters** — multi-select pills
- **Favorites** — heart icon, saved in localStorage
- **Only available** — hides sold-out and past showtimes
- **Search** — filter by title, description, or director
- **Responsive** — optimized for both desktop and mobile
