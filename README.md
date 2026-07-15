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

## Tech

- Frontend: Vanilla HTML/CSS/JS, Google Fonts (Fraunces, DM Sans, JetBrains Mono)
- Crawler: Node.js + axios + cheerio
- Hosting: GitHub Pages (free)
- Automation: GitHub Actions cron (free for public repos)
