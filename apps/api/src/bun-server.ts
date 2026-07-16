import { resolve } from "node:path";
import { cloneAuthState, configureAuthStore, emptyAuthState } from "./auth";
import { BunSqliteStateStore } from "./bun-sqlite-store";
import api, {
	cloneQueueState,
	configureQueueStore,
	emptyQueueState,
} from "./main";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const publicDir = resolve(process.env.PUBLIC_DIR || "apps/client/dist/client");
const databasePath = process.env.DATABASE_PATH || "/data/open-questions.sqlite";

configureQueueStore(
	new BunSqliteStateStore(
		databasePath,
		"queue",
		emptyQueueState(),
		cloneQueueState,
	),
);
configureAuthStore(
	new BunSqliteStateStore(
		databasePath,
		"auth",
		emptyAuthState(),
		cloneAuthState,
	),
);

function staticResponse(pathname: string): Response {
	const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
	const requestedPath = resolve(publicDir, relativePath);
	const safePath = requestedPath.startsWith(`${publicDir}/`)
		? requestedPath
		: resolve(publicDir, "index.html");
	const file = Bun.file(safePath);

	if (file.size > 0) return new Response(file);
	return new Response(Bun.file(resolve(publicDir, "index.html")));
}

Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
			url.pathname = url.pathname.slice(4) || "/";
			return api.fetch(new Request(url.toString(), request));
		}

		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method not allowed", { status: 405 });
		}
		return staticResponse(url.pathname);
	},
});

console.log(`Open Questions listening on http://0.0.0.0:${port}`);
