# Self-hosting Open Questions

The production image runs the pre-rendered UI and the Bun/Hono API in one
container. The UI is served at `/`, the API is mounted at `/api`, and Bun stores
queue and authentication state in a SQLite database under `/data`.

## Requirements

- Docker Engine or Docker Desktop
- Port 8080 available locally, or another host port of your choice

## Build and run

From the repository root:

```bash
docker build -t open-questions .
docker run --detach \
  --name open-questions \
  --publish 8080:8080 \
  --volume open-questions-data:/data \
  --restart unless-stopped \
  open-questions
```

Open <http://localhost:8080>. The API health endpoint is available at
<http://localhost:8080/api/health>.

The named `open-questions-data` volume is important: without persistent storage,
queue claims, research submissions, sessions, and API tokens disappear when the
container is replaced.

## Configuration

Runtime settings are passed with `docker run --env KEY=value` or an env file:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port Bun listens on inside the container |
| `DATABASE_PATH` | `/data/open-questions.sqlite` | SQLite database location |
| `PAGES_ORIGIN` | `http://localhost:8080` | Public origin used for redirects and OAuth |
| `GITHUB_CLIENT_ID` | unset | GitHub OAuth application client ID |
| `GITHUB_CLIENT_SECRET` | unset | GitHub OAuth application secret |
| `CONTRIBUTION_AUTH_REQUIRED` | unset | Require API-token authentication for contributions |
| `ALLOW_DEV_AUTH` | unset | Enable development authentication endpoints |

For example:

```bash
docker run --detach \
  --name open-questions \
  --publish 8080:8080 \
  --volume open-questions-data:/data \
  --env PAGES_ORIGIN=https://questions.example.com \
  --env-file .env.self-hosted \
  --restart unless-stopped \
  open-questions
```

Do not commit the env file. When GitHub OAuth is enabled, configure the OAuth
application callback URL as:

```text
https://questions.example.com/api/auth/github/callback
```

## Reverse proxy

Terminate TLS at a reverse proxy and forward the public origin to container port
8080. Preserve the request path so `/api/*` reaches the API and all other paths
reach the UI. Set `PAGES_ORIGIN` to the external HTTPS origin, not the container's
internal address.

## Persistence and backups

The container uses `BunSqliteStateStore` for both queue and authentication data.
Each store has a separate key in the same SQLite database. The Cloudflare Worker
deployment remains backed by Durable Objects and is unaffected by this setting.

For a simple consistent backup, stop the container before copying the named
volume's SQLite file. Restore it at the path selected by `DATABASE_PATH` before
starting the replacement container.

## Operations

Check container and application health:

```bash
docker inspect --format '{{json .State.Health}}' open-questions
curl --fail http://localhost:8080/api/health
```

View logs and replace the running image:

```bash
docker logs --follow open-questions
docker stop open-questions
docker rm open-questions
docker build -t open-questions .
```

Start it again with the same named volume to retain persisted state.

## Validate the image with `act`

The Docker workflow builds the image, starts the unified service, and smoke-tests
both the rendered UI and `/api/health`. Run it locally with an explicit runner
image:

```bash
act workflow_dispatch \
  -W .github/workflows/docker.yml \
  -P ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest
```

The `-P` mapping tells `act` to use that runner image. The workflow retains a
fast `ACT`-specific step that installs the Docker CLI and curl when the selected
runner does not already provide them.

## Persistence adapters

The API depends on the `StateStore<T>` interface rather than SQLite directly.
The single-container entrypoint injects `BunSqliteStateStore`; local development
can use the JSON-file adapter, and another Bun-compatible store can be supplied
through `configureQueueStore()` and `configureAuthStore()`.
