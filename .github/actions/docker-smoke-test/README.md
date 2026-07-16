# Docker build and smoke test

Builds the repository's unified Docker image and starts it with the API, client,
and Muxox Web UI exposed on ports 3030, 3031, and 3032. The action waits for
all three endpoints to become available, verifies the API health response and
client HTML, and stops the temporary container when finished.

The image is tagged with `GITHUB_SHA` (or `local` when that variable is not
set). Set `DOCKER_SMOKE_HOST` when the endpoints are reachable through a host
name other than `127.0.0.1`.
