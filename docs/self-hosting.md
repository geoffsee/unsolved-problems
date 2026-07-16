# Self-hosting Open Questions

The root Docker image runs one Muxox-supervised container with three endpoints:

- action API and cron scheduler on port `3030`
- pre-rendered client UI on port `3031`
- Muxox Web UI on port `3032`
- application API on port `3040`

The API stores run history and cron claims in SQLite under `/data`. Workflows
and local actions are loaded from the fixed `/workspace/.github` mount.

Application auth (sessions, local accounts, and contribution API tokens) is
persisted in `/data/open-questions.sqlite` alongside queue state.

## Requirements

- Docker Engine or Docker Desktop
- Ports `3030`, `3031`, `3032`, and `3040`, or alternative host port mappings

## Run with Compose

From the repository root:

```bash
docker compose up --build -d
```

The Compose build sets `PREINSTALL_MCP_SERVERS=true`, dynamically preinstalling
the `bunx` MCP servers declared in `apps/example/.mcp.json`. To skip this step,
use a direct Docker build without the argument; to enable it explicitly:

```bash
docker build --build-arg PREINSTALL_MCP_SERVERS=true -t open-questions-actions .
```

Open the client at <http://localhost:3031> and Muxox at
<http://localhost:3032>. Check the API at <http://localhost:3030/health>.

The root `compose.yml` mounts `.github` read-only and stores SQLite data in
the named `open-questions_action-data` volume. Place secrets and workflow
environment values in the ignored optional `.env.open-questions` file.

## Run with Docker

```bash
docker pull ghcr.io/geoffsee/open-questions
docker run --detach \
  --name open-questions-actions \
  --publish 3030:3030 \
  --publish 3031:3031 \
  --publish 3032:3032 \
  --publish 3040:3040 \
  --env-file .env.open-questions \
  --volume "$PWD/.github:/workspace/.github:ro" \
  --volume open-questions-action-data:/data \
  --restart unless-stopped \
  ghcr.io/geoffsee/open-questions
```

Omit `--env-file .env.open-questions` when the file is not needed.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3030` | Action API port |
| `PAGES_ORIGIN` | `http://localhost:3031` | Client origin allowed for OAuth redirects |
| `GITHUB_CLIENT_ID` | unset | Optional GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | unset | Optional GitHub OAuth client secret |
| `CONTRIBUTION_AUTH_REQUIRED` | unset | Force (`1`) or disable (`0`) Bearer tokens on write tools; default requires auth when local accounts or GitHub OAuth can mint tokens |
| `AUTH_DISABLED` | unset | Set `1` only for open local development (disables auth enforcement and local account endpoints) |
| `REPOSITORY_ROOT` | `/workspace` | Repository root containing `.github` |
| `DATABASE_URL` | `sqlite:///data/local-action.sqlite` | Run and cron state |
| `DATABASE_PATH` | `/data/open-questions.sqlite` | Application queue + auth SQLite store |
| `API_TOKEN` | unset | Optional bearer token protecting API routes except health |
| `PUBLISH_KEY` | unset | Bearer secret required by the data publish endpoint |
| `PUBLISH_API_ORIGIN` | `http://localhost:3040/api` | API origin used by the compiled publish CLI |
| `PUBLISH_MANIFEST` | `public/data/manifest.json` | Active category/source manifest passed to the compiled publish CLI |
| `PUBLISH_DATA_DIR` | `data/published` | Directory containing published `.json.zst` files |

The application API is available at `http://localhost:3040`. Its user-facing
auth and API-key endpoints are under `/auth`; the action API remains at
`http://localhost:3030`.

`API_TOKEN` protects the local action API only. The application API supports:

1. **Local username/password accounts** (always available unless `AUTH_DISABLED=1`)
   - `POST /auth/register` — create an account and session
   - `POST /auth/login` — exchange credentials for a session
2. **Optional GitHub OAuth** when `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
   are set (`/auth/github` and `/auth/github/callback`)

After signing in (local session or GitHub session), users can create, list, and
revoke personal `up_live_...` contribution API tokens via `/auth/tokens`. Agent
write tools require `Authorization: Bearer <token>` when contribution auth is
required (the default for self-hosted deployments).

Public catalog reads (`/data/*`, problem listings, queue snapshots) remain
available without authentication when OAuth is unconfigured. Only contribution
writes are gated.

Auth data (accounts, sessions, API token hashes) lives in the `/data` volume
through `DATABASE_PATH=/data/open-questions.sqlite`. Deleting the volume wipes
local accounts and issued tokens.

Data actions publish through the compiled `open-questions-publish` CLI. Set
`PUBLISH_KEY` in `.env.open-questions`; the API stores published data as zstd
compressed files under `PUBLISH_DATA_DIR` and serves it at `/data/*.json`.
The active category/source manifest is served at `/data/manifest.json`; each
published catalog data file must contain exactly the categories it declares.

Cloudflare Worker deployments use the configured `open_questions_data` R2
binding instead of the local filesystem. R2 stores the published JSON objects
under their `/data/`-relative names; the Bun self-hosted server continues to
use the compressed filesystem format above.

## Local account quick start

```bash
# Register
curl -sS -X POST http://localhost:3040/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"operator","password":"change-me-now","name":"Operator"}'

# Log in
curl -sS -X POST http://localhost:3040/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"operator","password":"change-me-now"}'

# Create a contribution token (use sessionToken from login/register)
curl -sS -X POST http://localhost:3040/auth/tokens \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $SESSION_TOKEN" \
  -d '{"label":"morning agent"}'
```

Usernames are case-insensitive (3–32 characters: letters, numbers, `_`, `-`).
Passwords must be at least 8 characters. Passwords are stored as PBKDF2-SHA256
hashes with a random salt; plaintext is never persisted.

The client auth panel at <http://localhost:3031> exposes the same register and
login flows alongside **Sign in with GitHub** when OAuth is configured.

## Operations

```bash
docker compose ps
docker compose logs --follow
curl --fail http://localhost:3030/health
docker compose down
```

The named data volume remains after `docker compose down`. Use
`docker compose down --volumes` only when the stored action history, cron
claims, local accounts, and API tokens should be deleted.
