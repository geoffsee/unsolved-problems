FROM oven/bun:1.3.8-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/client/package.json apps/client/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/example/package.json apps/example/package.json
RUN bun install --frozen-lockfile

COPY apps/client apps/client
COPY apps/api apps/api

ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ARG VITE_API_ORIGIN=/api
ENV VITE_API_ORIGIN=${VITE_API_ORIGIN}
RUN cd apps/client && bun run build

FROM oven/bun:1.3.8-alpine

WORKDIR /app

ENV PORT=8080 \
	PUBLIC_DIR=/app/apps/client/dist/client \
	DATABASE_PATH=/data/open-questions.sqlite \
	PAGES_ORIGIN=http://localhost:8080

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api apps/api
COPY --from=build /app/apps/client/dist/client apps/client/dist/client

RUN mkdir -p /data

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
	CMD bun -e 'fetch("http://127.0.0.1:8080/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

CMD ["bun", "run", "apps/api/src/bun-server.ts"]
