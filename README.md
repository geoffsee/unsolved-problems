# Catalog of the Unsolved

A curated index of open questions across scientific disciplines, sourced from Wikipedia's peer-reviewed problem lists. Includes AI-generated enrichments for each problem.

**Live site:** [geoffsee.github.io/unsolved-problems](https://geoffsee.github.io/unsolved-problems/)

## Stack

- **React + Vike** (prerendered static site)
- **Chakra UI** for styling
- **Wikipedia API** for problem data (fetched at build time)
- **Claude API** for AI enrichments (summaries, significance, field, year)
- **GitHub Pages** for hosting, deployed nightly via CI

## Development

```bash
cd apps/client
bun install
bun run fetch-data
bun run fetch-news
bun run fetch-cases
bun run dev
```

## Data Pipeline

Run by CI nightly or on push to `master`:

1. `fetch-data` — scrapes unsolved problem lists from Wikipedia
2. `fetch-news` — pulls frontier research articles via Perigon
3. `fetch-cases` — loads official FBI ViCAP missing-person and homicide listings through Playwright
4. `enrich-data` — generates structured metadata per problem using Claude
5. `vike build` — prerenders everything into a static site

`fetch-news` writes the live feed to `apps/client/public/data/news.json` and also keeps daily snapshots in `apps/client/public/data/news-history/` with an `index.json` manifest.
`fetch-cases` writes the live FBI ViCAP feed to `apps/client/public/data/cases.json` and keeps daily snapshots in `apps/client/public/data/case-history/` with an `index.json` manifest.
