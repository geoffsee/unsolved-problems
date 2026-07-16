FROM docker:28-cli AS docker-cli

FROM alpine:3.22 AS muxox
ARG TARGETARCH
RUN case "$TARGETARCH" in \
		amd64) target="x86_64" ;; \
		arm64) target="aarch64" ;; \
		*) echo "Unsupported Muxox architecture: $TARGETARCH" >&2; exit 1 ;; \
	esac \
	&& wget -qO /tmp/muxox.tar.gz \
		"https://github.com/geoffsee/muxox/releases/latest/download/muxox-${target}-unknown-linux-gnu.tar.gz" \
	&& tar -xzf /tmp/muxox.tar.gz -C /usr/local/bin \
	&& chmod +x /usr/local/bin/muxox

FROM node:24-trixie-slim

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=muxox /usr/local/bin/muxox /usr/local/bin/muxox
RUN npm install --global bun@1.3.9

WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps/action-server/package.json apps/action-server/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/client/package.json apps/client/package.json
COPY apps/example/package.json apps/example/package.json
COPY apps/example/.mcp.json apps/example/.mcp.json
RUN bun install --frozen-lockfile

COPY . .

# Warm Bun's global executable cache for every bunx-backed MCP server declared
# in apps/example/.mcp.json. Other commands (such as uvx) are left untouched.
ARG PREINSTALL_MCP_SERVERS=false
RUN if [ "$PREINSTALL_MCP_SERVERS" = "true" ]; then \
		bun run apps/example/scripts/preinstall-mcp.ts; \
	fi

RUN VITE_BASE_PATH=/ VITE_API_ORIGIN=http://localhost:3040/api bun run --cwd apps/client build \
	&& bun run --cwd apps/client build:cli \
	&& mkdir -p /workspace/.github /data

ENV PORT=3030 \
	REPOSITORY_ROOT=/workspace \
	DATABASE_URL=sqlite:///data/local-action.sqlite \
	PAGES_ORIGIN=http://localhost:3031 \
	DOCKER_SMOKE_HOST=host.docker.internal

EXPOSE 3030 3031 3032 3040
VOLUME ["/workspace/.github", "/data"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
	CMD bun -e 'fetch("http://127.0.0.1:3030/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

CMD ["muxox", "--config", "/workspace/muxox.toml", "--port", "3032"]
