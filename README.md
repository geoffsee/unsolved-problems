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
bun run dev
```

## Data Pipeline

Run by CI nightly or on push to `master`:

1. `fetch-data` — scrapes unsolved problem lists from Wikipedia
2. `fetch-news` — pulls frontier research articles via Perigon
3. `enrich-data` — generates structured metadata per problem using Claude
4. `vike build` — prerenders everything into a static site
