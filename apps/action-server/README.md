# Local action server

A small Bun/Hono API around
[`@github/local-action`](https://github.com/github/local-action). Run it from the
repository:

```bash
bun install
API_TOKEN=change-me bun run actions:server
```

For supervised development with bounded logs, run the API and client through
Muxox:

```bash
cargo binstall muxox
API_TOKEN=change-me bun run actions:mux
```

The committed [`muxox.toml`](../../muxox.toml) is the complete service map: its
`api` service runs the action HTTP/scheduler on port `3030`, its `ui` service
runs the built Vike client with a static production server on port `3031`, and `muxox-web-proxy`
publishes Muxox's Web UI on port `3032`. The Docker image builds the client at
image-build time; on a host, the service builds it once if `dist` is absent.
Individual action processes remain owned by the API so their exit codes and
logs can be recorded accurately in SQL.

The container downloads the latest architecture-matched Muxox binary directly
from GitHub Releases and invokes its management Web UI with `--port 3032`. Since
Muxox 1.6 binds that listener to `[::1]`, the proxy service republishes the same
port on the container's IPv4 interface. That port is separate from the
application client on `3031`. No Rust toolchain or npm wrapper is included in
the final image.

Environment variables:

- `REPOSITORY_ROOT` (default: this monorepo's root; `/workspace` in Docker)
- `DATABASE_URL` (default: `sqlite://local-action.sqlite`)
- `PORT` (default: `3030`)
- `API_TOKEN` (recommended; all routes except `/health` require it when set)

## API

- `GET /workflows` lists workflow cron entries, runnable local actions, and
  unsupported shell/remote-action steps.
- `POST /workflows/:id/run` starts every `uses: ./...` step in that workflow.
- `POST /actions/run` directly wraps the documented CLI arguments.
- `GET /runs` and `GET /runs/:id` return persisted status and output.

Direct invocation:

```bash
curl -X POST http://localhost:3030/actions/run \
  -H 'authorization: Bearer change-me' \
  -H 'content-type: application/json' \
  -d '{
    "path": ".github/actions/example",
    "entrypoint": "src/main.ts",
    "dotenv": ".env.local",
    "pre": "src/pre.ts",
    "post": "src/post.ts"
  }'
```

Workflow runs need a logic entrypoint and may need a dotenv file. The server
automatically detects the conventional `src/main.ts` or `src/main.js`. Put
non-standard entrypoints in `.github/local-action.json`; request values can
override them by action path or by `job.step`:

```json
{
  "actions": {
    "./.github/actions/example": {
      "entrypoint": "src/main.ts",
      "dotenv": ".env.local"
    }
  }
}
```

## Docker

The container uses `/workspace/.github` as its stable workflow mount point. The
mounted directory supplies the workflows, local action source, and optional
`local-action.json`, so no host-specific paths are needed:

```bash
docker compose up --build
```

The root [`compose.yml`](../../compose.yml) publishes the action API on `3030`,
the client on `3031`, and Muxox on `3032`. It also mounts `.github`, persists
SQLite data, and loads an optional ignored `.env.actions` file containing action
secrets and environment values.

The equivalent direct Docker commands are:

```bash
docker build -t open-questions-actions .

docker run --rm \
  --name open-questions-actions \
  --publish 3030:3030 \
  --publish 3031:3031 \
  --publish 3032:3032 \
  --env API_TOKEN=change-me \
  --env-file .env.actions \
  --volume "$PWD/.github:/workspace/.github:ro" \
  --volume open-questions-action-data:/data \
  open-questions-actions
```

The named `/data` volume persists run history and cron claims. Variables in
`.env.actions` provide values for `${{ secrets.NAME }}` and `${{ env.NAME }}`
references when cron runs locally.

The Docker smoke-test action also needs access to a Docker daemon. Add these
options on Linux or Docker Desktop:

```bash
--volume /var/run/docker.sock:/var/run/docker.sock \
--add-host host.docker.internal:host-gateway
```

Only `.github` needs to be mounted for the actions included in this image. A
third-party action that reads other repository files must include those files in
the image or mount them under `/workspace` as well.

The repository's three local actions follow the TypeScript action layout and are
already registered there. If their source changes, rebuild the committed GitHub
runner bundles:

```bash
bun run actions:build
```

When `dotenv` is omitted for a workflow action, the server generates a temporary
dotenv file from the step's `with`, `env`, and request `env` values. The five-field
workflow cron expressions are checked in UTC and claimed once per minute in SQL.

`local-action` does not execute workflow YAML, `run:` shell steps, remote
`owner/action@ref` actions, Docker actions, or composite actions. This server
keeps that same boundary.
