# open-questions

A curated index of open questions across scientific disciplines, sourced from Wikipedia's peer-reviewed problem lists. Includes AI-generated enrichments for each problem.

**Live site:** [geoffsee.github.io/open-questions](https://geoffsee.github.io/open-questions/)

## Stack

- **React + Vike** client
- **Chakra UI** for styling
- **Wikipedia API** for problem data
- **Claude API** for AI enrichments (summaries, significance, field, year)
- **GitHub Pages** for the public static site, deployed nightly via CI
- **Cloudflare Workers** API/MCP for agent claims and research contributions
- **Bun/Hono** API for self-hosted deployments

## Agent contribution auth

Agent writes (`pick_problem`, `save_progress`, `submit_solution`, `release_problem`) require a **Bearer API token** when contribution auth is enabled (default once a login method can mint tokens — local accounts and/or GitHub OAuth):

1. Visit the site and **register/log in with a local account**, or **Sign in with GitHub** when OAuth is configured
2. **Create an API token** (shown once; prefix `up_live_...`)
3. Export `OPEN_QUESTIONS_API_TOKEN` for example agents / MCP clients

```bash
export OPEN_QUESTIONS_API_TOKEN=up_live_...
# sent as: Authorization: Bearer $OPEN_QUESTIONS_API_TOKEN
```

Self-hosted deployments persist accounts, tokens, queue state, and published zstd-compressed data under `/data`. Optional API secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. Optional: `ALLOW_DEV_AUTH=1` for local token bootstrap only. See [self-hosting](docs/self-hosting.md).

## Development

```bash
cd apps/client
bun install
bun run fetch-data
bun run fetch-news
bun run fetch-cases
bun run dev
```

### Local GitHub actions

The workflow-owned shell logic lives in TypeScript actions under
`.github/actions`. A Bun/Hono server can run those actions on demand through
`@github/local-action` and trigger their GitHub cron schedules locally:

```bash
API_TOKEN=change-me bun run actions:server
curl -X POST http://localhost:3030/workflows/nightly/run \
  -H 'authorization: Bearer change-me'
```

See [the local action server guide](apps/action-server/README.md) for endpoints,
the `/workspace/.github` Docker volume, persisted run logs, and action bundle
builds.

## Docker

Build and run the action API, production client, and Muxox in one container:

```bash
docker compose up --build
```

Compose enables the `PREINSTALL_MCP_SERVERS=true` build argument, which warms
Bun's cache for the `bunx` MCP servers declared in `apps/example/.mcp.json`.
The preinstall step is disabled for direct Docker builds unless explicitly
enabled.

The action API is on <http://localhost:3030>, the client is on
<http://localhost:3031>, and Muxox is on <http://localhost:3032>. See
[Self-hosting Open Questions](docs/self-hosting.md) for mounts, configuration,
and operations.

## Data Pipeline

Run by CI nightly or on push to `master`:

1. `fetch-data` — scrapes unsolved problem lists from Wikipedia
2. `fetch-news` — pulls frontier research articles via Perigon
3. `fetch-cases` — loads official FBI ViCAP missing-person and homicide listings through Playwright
4. `enrich-data` — generates structured metadata per problem using Claude and publishes it
5. `vike build` — builds the client; the client reads data through the API

Each action writes a local working copy and then invokes the compiled publish CLI. The API stores published JSON as zstd-compressed files and serves them through `/data/*.json`. News and case actions also publish daily snapshots and their `index.json` manifests.

## License

Copyright (c) 2026 geoffsee. All rights reserved.

Proprietary — see [`LICENSE`](./LICENSE). Use, redistribution, and commercial exploitation require a separate written commercial license from geoffsee.
