import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type AuthBindings = {
	PAGES_ORIGIN?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	AUTH_DISABLED?: string;
	CONTRIBUTION_AUTH_REQUIRED?: string;
	ALLOW_DEV_AUTH?: string;
	AUTH_STORE?: DurableObjectNamespace;
};

export type GitHubUser = {
	id: number;
	login: string;
	name: string | null;
	avatarUrl: string | null;
};

export type SessionRecord = {
	sessionId: string;
	tokenHash: string;
	user: GitHubUser;
	createdAt: string;
	expiresAt: string;
};

export type ApiTokenRecord = {
	tokenId: string;
	tokenHash: string;
	tokenPrefix: string;
	label: string;
	user: GitHubUser;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
};

export type AuthStoreState = {
	sessionsById: Record<string, SessionRecord>;
	tokensById: Record<string, ApiTokenRecord>;
	/** sha256(token) -> tokenId or sessionId with kind prefix */
	lookupByHash: Record<string, string>;
};

export type AuthenticatedPrincipal = {
	kind: "session" | "api_token";
	user: GitHubUser;
	sessionId?: string;
	tokenId?: string;
	label?: string;
};

export type PublicApiToken = {
	tokenId: string;
	tokenPrefix: string;
	label: string;
	createdAt: string;
	lastUsedAt: string | null;
	user: Pick<GitHubUser, "id" | "login" | "name" | "avatarUrl">;
};

export const CONTRIBUTION_TOOLS = new Set([
	"pick_problem",
	"release_problem",
	"submit_solution",
	"save_progress",
]);

const DEFAULT_PAGES_ORIGIN = "https://geoffsee.github.io/open-questions";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

let localAuthState: AuthStoreState = emptyAuthState();

function emptyAuthState(): AuthStoreState {
	return {
		sessionsById: {},
		tokensById: {},
		lookupByHash: {},
	};
}

function nowIso() {
	return new Date().toISOString();
}

function getLocalAuthPath() {
	try {
		const metaUrl =
			typeof import.meta !== "undefined" ? import.meta.url : undefined;
		if (
			typeof process === "undefined" ||
			!process.versions?.node ||
			typeof metaUrl !== "string" ||
			!metaUrl.startsWith("file:")
		) {
			return null;
		}

		return (
			process.env.OPEN_QUESTIONS_AUTH_PATH ||
			fileURLToPath(new URL("../data/auth-store.json", metaUrl))
		);
	} catch {
		return null;
	}
}

export function cloneAuthState(state: AuthStoreState): AuthStoreState {
	return {
		sessionsById: Object.fromEntries(
			Object.entries(state.sessionsById).map(([key, value]) => [
				key,
				{ ...value, user: { ...value.user } },
			]),
		),
		tokensById: Object.fromEntries(
			Object.entries(state.tokensById).map(([key, value]) => [
				key,
				{ ...value, user: { ...value.user } },
			]),
		),
		lookupByHash: { ...state.lookupByHash },
	};
}

function readLocalAuthState(): AuthStoreState {
	const path = getLocalAuthPath();
	if (path && existsSync(path)) {
		try {
			return cloneAuthState(
				JSON.parse(readFileSync(path, "utf-8")) as AuthStoreState,
			);
		} catch {
			return cloneAuthState(localAuthState);
		}
	}
	return cloneAuthState(localAuthState);
}

function writeLocalAuthState(state: AuthStoreState) {
	localAuthState = cloneAuthState(state);
	const path = getLocalAuthPath();
	if (!path) return;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(localAuthState, null, 2));
	} catch {
		// Keep serving from memory if disk is unavailable.
	}
}

export function resetLocalAuthStateForTests() {
	localAuthState = emptyAuthState();
}

export function getPagesOrigin(env?: AuthBindings) {
	return (
		env?.PAGES_ORIGIN ||
		process.env.PAGES_ORIGIN ||
		DEFAULT_PAGES_ORIGIN
	).replace(/\/+$/, "");
}

/**
 * Normalize secret/env values. Dashboards and .env copy-paste often produce a
 * leading "=" (e.g. client_id becomes "=Ov23li..."), which makes GitHub OAuth 404.
 */
export function sanitizeSecretValue(value: string | undefined | null): string {
	if (!value) return "";
	let next = value.trim();
	// Strip a single accidental leading "=" from KEY=value paste mistakes.
	if (next.startsWith("=")) {
		next = next.slice(1).trim();
	}
	// Common wrapping when secrets are pasted with quotes.
	if (
		(next.startsWith('"') && next.endsWith('"')) ||
		(next.startsWith("'") && next.endsWith("'"))
	) {
		next = next.slice(1, -1).trim();
	}
	return next;
}

export function getGithubClientId(env?: AuthBindings) {
	return sanitizeSecretValue(
		env?.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID,
	);
}

export function getGithubClientSecret(env?: AuthBindings) {
	return sanitizeSecretValue(
		env?.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET,
	);
}

export function isAuthDisabled(env?: AuthBindings) {
	return env?.AUTH_DISABLED === "1" || process.env.AUTH_DISABLED === "1";
}

export function isDevAuthAllowed(env?: AuthBindings) {
	return env?.ALLOW_DEV_AUTH === "1" || process.env.ALLOW_DEV_AUTH === "1";
}

/**
 * Contribution (write) tools require a Bearer API token once GitHub OAuth is
 * configured, or when CONTRIBUTION_AUTH_REQUIRED=1. Tests can set AUTH_DISABLED=1.
 */
export function isContributionAuthRequired(env?: AuthBindings) {
	if (isAuthDisabled(env)) return false;
	if (
		env?.CONTRIBUTION_AUTH_REQUIRED === "1" ||
		process.env.CONTRIBUTION_AUTH_REQUIRED === "1"
	) {
		return true;
	}
	if (
		env?.CONTRIBUTION_AUTH_REQUIRED === "0" ||
		process.env.CONTRIBUTION_AUTH_REQUIRED === "0"
	) {
		return false;
	}
	return Boolean(getGithubClientId(env));
}

export function isSafeReturnTo(returnTo: string, env?: AuthBindings): boolean {
	try {
		const url = new URL(returnTo);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const allowed = new URL(getPagesOrigin(env));
		if (url.origin === allowed.origin) return true;
		// Local static previews
		if (
			url.hostname === "localhost" ||
			url.hostname === "127.0.0.1" ||
			url.hostname === "[::1]"
		) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

export async function sha256Hex(value: string): Promise<string> {
	const data = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function randomToken(bytes = 32): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseBearerToken(request: Request): string | null {
	const header = request.headers.get("authorization");
	if (!header) return null;
	const match = header.match(/^Bearer\s+(.+)$/i);
	if (!match?.[1]) return null;
	const token = match[1].trim();
	return token || null;
}

export function publicTokenView(token: ApiTokenRecord): PublicApiToken {
	return {
		tokenId: token.tokenId,
		tokenPrefix: token.tokenPrefix,
		label: token.label,
		createdAt: token.createdAt,
		lastUsedAt: token.lastUsedAt,
		user: {
			id: token.user.id,
			login: token.user.login,
			name: token.user.name,
			avatarUrl: token.user.avatarUrl,
		},
	};
}

function pruneExpiredSessions(state: AuthStoreState) {
	const now = Date.now();
	let changed = false;
	for (const [sessionId, session] of Object.entries(state.sessionsById)) {
		if (new Date(session.expiresAt).getTime() <= now) {
			delete state.sessionsById[sessionId];
			delete state.lookupByHash[session.tokenHash];
			changed = true;
		}
	}
	return changed;
}

async function callAuthObject(
	env: AuthBindings,
	path: string,
	init?: RequestInit,
) {
	const id = env.AUTH_STORE?.idFromName("global");
	const stub = id && env.AUTH_STORE?.get(id);
	if (!stub) {
		throw new Error("AUTH_STORE Durable Object binding is not configured.");
	}
	const response = await stub.fetch(`https://auth-store.internal${path}`, init);
	if (!response.ok) {
		const message = await response.text();
		throw new Error(
			message || `Auth store request failed with ${response.status}.`,
		);
	}
	return response.json();
}

export async function resolvePrincipal(
	request: Request,
	env?: AuthBindings,
): Promise<AuthenticatedPrincipal | null> {
	const token = parseBearerToken(request);
	if (!token) return null;

	const tokenHash = await sha256Hex(token);

	if (env?.AUTH_STORE) {
		const result = (await callAuthObject(env, "/resolve", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ tokenHash }),
		})) as { principal: AuthenticatedPrincipal | null };
		return result.principal;
	}

	const state = readLocalAuthState();
	if (pruneExpiredSessions(state)) writeLocalAuthState(state);

	const lookup = state.lookupByHash[tokenHash];
	if (!lookup) return null;

	if (lookup.startsWith("session:")) {
		const sessionId = lookup.slice("session:".length);
		const session = state.sessionsById[sessionId];
		if (!session) return null;
		if (new Date(session.expiresAt).getTime() <= Date.now()) {
			delete state.sessionsById[sessionId];
			delete state.lookupByHash[tokenHash];
			writeLocalAuthState(state);
			return null;
		}
		return {
			kind: "session",
			user: session.user,
			sessionId: session.sessionId,
		};
	}

	if (lookup.startsWith("token:")) {
		const tokenId = lookup.slice("token:".length);
		const record = state.tokensById[tokenId];
		if (!record || record.revokedAt) return null;
		record.lastUsedAt = nowIso();
		writeLocalAuthState(state);
		return {
			kind: "api_token",
			user: record.user,
			tokenId: record.tokenId,
			label: record.label,
		};
	}

	return null;
}

export async function createSession(
	user: GitHubUser,
	env?: AuthBindings,
): Promise<{ sessionToken: string; session: SessionRecord }> {
	const sessionId = `sess_${randomToken(12)}`;
	const sessionToken = `up_sess_${randomToken(32)}`;
	const tokenHash = await sha256Hex(sessionToken);
	const session: SessionRecord = {
		sessionId,
		tokenHash,
		user,
		createdAt: nowIso(),
		expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
	};

	if (env?.AUTH_STORE) {
		await callAuthObject(env, "/sessions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(session),
		});
		return { sessionToken, session };
	}

	const state = readLocalAuthState();
	pruneExpiredSessions(state);
	state.sessionsById[sessionId] = session;
	state.lookupByHash[tokenHash] = `session:${sessionId}`;
	writeLocalAuthState(state);
	return { sessionToken, session };
}

export async function revokeSession(
	sessionId: string,
	env?: AuthBindings,
): Promise<boolean> {
	if (env?.AUTH_STORE) {
		const result = (await callAuthObject(
			env,
			`/sessions/${encodeURIComponent(sessionId)}`,
			{ method: "DELETE" },
		)) as { ok: boolean };
		return result.ok;
	}

	const state = readLocalAuthState();
	const session = state.sessionsById[sessionId];
	if (!session) return false;
	delete state.sessionsById[sessionId];
	delete state.lookupByHash[session.tokenHash];
	writeLocalAuthState(state);
	return true;
}

export async function createApiToken(
	user: GitHubUser,
	label: string,
	env?: AuthBindings,
): Promise<{ token: string; record: ApiTokenRecord }> {
	const tokenId = `tok_${randomToken(12)}`;
	const token = `up_live_${randomToken(32)}`;
	const tokenHash = await sha256Hex(token);
	const record: ApiTokenRecord = {
		tokenId,
		tokenHash,
		tokenPrefix: token.slice(0, 12),
		label: label.trim() || "Agent token",
		user,
		createdAt: nowIso(),
		lastUsedAt: null,
		revokedAt: null,
	};

	if (env?.AUTH_STORE) {
		await callAuthObject(env, "/tokens", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(record),
		});
		return { token, record };
	}

	const state = readLocalAuthState();
	state.tokensById[tokenId] = record;
	state.lookupByHash[tokenHash] = `token:${tokenId}`;
	writeLocalAuthState(state);
	return { token, record };
}

export async function listApiTokens(
	userId: number,
	env?: AuthBindings,
): Promise<PublicApiToken[]> {
	if (env?.AUTH_STORE) {
		const result = (await callAuthObject(
			env,
			`/tokens?userId=${encodeURIComponent(String(userId))}`,
		)) as { tokens: PublicApiToken[] };
		return result.tokens;
	}

	const state = readLocalAuthState();
	return Object.values(state.tokensById)
		.filter((token) => token.user.id === userId && !token.revokedAt)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.map(publicTokenView);
}

export async function revokeApiToken(
	tokenId: string,
	userId: number,
	env?: AuthBindings,
): Promise<boolean> {
	if (env?.AUTH_STORE) {
		const result = (await callAuthObject(
			env,
			`/tokens/${encodeURIComponent(tokenId)}`,
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ userId }),
			},
		)) as { ok: boolean };
		return result.ok;
	}

	const state = readLocalAuthState();
	const record = state.tokensById[tokenId];
	if (!record || record.user.id !== userId || record.revokedAt) return false;
	record.revokedAt = nowIso();
	delete state.lookupByHash[record.tokenHash];
	writeLocalAuthState(state);
	return true;
}

function toBase64Url(bytes: Uint8Array | string): string {
	const raw =
		typeof bytes === "string"
			? btoa(bytes)
			: btoa(String.fromCharCode(...bytes));
	return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const pad =
		padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
	return atob(padded + pad);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** Stateless signed OAuth state (survives Worker isolate hops). */
export async function createOAuthState(
	returnTo: string,
	env?: AuthBindings,
): Promise<string> {
	const secret = getGithubClientSecret(env) || "local-dev-oauth-state";
	const payload = toBase64Url(
		JSON.stringify({
			returnTo,
			exp: Date.now() + OAUTH_STATE_TTL_MS,
			nonce: randomToken(8),
		}),
	);
	const sig = await hmacSha256Hex(secret, payload);
	return `${payload}.${sig}`;
}

export async function verifyOAuthState(
	state: string,
	env?: AuthBindings,
): Promise<string | null> {
	const [payload, sig] = state.split(".");
	if (!payload || !sig) return null;
	const secret = getGithubClientSecret(env) || "local-dev-oauth-state";
	const expected = await hmacSha256Hex(secret, payload);
	if (expected !== sig) return null;
	try {
		const parsed = JSON.parse(fromBase64Url(payload)) as {
			returnTo?: string;
			exp?: number;
		};
		if (!parsed.returnTo || typeof parsed.exp !== "number") return null;
		if (Date.now() > parsed.exp) return null;
		if (!isSafeReturnTo(parsed.returnTo, env)) return null;
		return parsed.returnTo;
	} catch {
		return null;
	}
}

export async function exchangeGithubCode(
	code: string,
	env?: AuthBindings,
): Promise<GitHubUser> {
	const clientId = getGithubClientId(env);
	const clientSecret = getGithubClientSecret(env);
	if (!clientId || !clientSecret) {
		throw new Error("GitHub OAuth is not configured on this API.");
	}

	const tokenResponse = await fetch(
		"https://github.com/login/oauth/access_token",
		{
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				code,
			}),
		},
	);

	if (!tokenResponse.ok) {
		throw new Error(`GitHub token exchange failed (${tokenResponse.status}).`);
	}

	const tokenPayload = (await tokenResponse.json()) as {
		access_token?: string;
		error?: string;
		error_description?: string;
	};

	if (!tokenPayload.access_token) {
		throw new Error(
			tokenPayload.error_description ||
				tokenPayload.error ||
				"GitHub did not return an access token.",
		);
	}

	const userResponse = await fetch("https://api.github.com/user", {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${tokenPayload.access_token}`,
			"user-agent": "unsolved-problems-api",
		},
	});

	if (!userResponse.ok) {
		throw new Error(`GitHub user lookup failed (${userResponse.status}).`);
	}

	const userPayload = (await userResponse.json()) as {
		id?: number;
		login?: string;
		name?: string | null;
		avatar_url?: string | null;
	};

	if (typeof userPayload.id !== "number" || !userPayload.login) {
		throw new Error("GitHub user payload was incomplete.");
	}

	return {
		id: userPayload.id,
		login: userPayload.login,
		name: userPayload.name ?? null,
		avatarUrl: userPayload.avatar_url ?? null,
	};
}

export function unauthorizedContributionMessage() {
	return [
		"Authentication required for agent contributions.",
		"Sign in with GitHub at the Catalog site, create an API token, and send it as Authorization: Bearer <token>.",
	].join(" ");
}

export function requireContributionAuth(
	principal: AuthenticatedPrincipal | null,
	env?: AuthBindings,
): AuthenticatedPrincipal | null {
	if (!isContributionAuthRequired(env)) {
		return principal;
	}
	if (!principal) {
		return null;
	}
	// Sessions are for the website token UI; agents must use API tokens.
	if (principal.kind !== "api_token") {
		return null;
	}
	return principal;
}

export class AuthStoreDurableObject {
	constructor(private state: DurableObjectState) {}

	private async readState(): Promise<AuthStoreState> {
		const stored = await this.state.storage.get<AuthStoreState>("auth");
		const auth = cloneAuthState(stored ?? emptyAuthState());
		if (pruneExpiredSessions(auth)) {
			await this.state.storage.put("auth", auth);
		}
		return auth;
	}

	private async writeState(auth: AuthStoreState) {
		await this.state.storage.put("auth", auth);
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const auth = await this.readState();

		if (url.pathname === "/resolve" && request.method === "POST") {
			const body = (await request.json()) as { tokenHash: string };
			const lookup = auth.lookupByHash[body.tokenHash];
			if (!lookup) return Response.json({ principal: null });

			if (lookup.startsWith("session:")) {
				const sessionId = lookup.slice("session:".length);
				const session = auth.sessionsById[sessionId];
				if (!session) return Response.json({ principal: null });
				if (new Date(session.expiresAt).getTime() <= Date.now()) {
					delete auth.sessionsById[sessionId];
					delete auth.lookupByHash[body.tokenHash];
					await this.writeState(auth);
					return Response.json({ principal: null });
				}
				return Response.json({
					principal: {
						kind: "session",
						user: session.user,
						sessionId: session.sessionId,
					} satisfies AuthenticatedPrincipal,
				});
			}

			if (lookup.startsWith("token:")) {
				const tokenId = lookup.slice("token:".length);
				const record = auth.tokensById[tokenId];
				if (!record || record.revokedAt) {
					return Response.json({ principal: null });
				}
				record.lastUsedAt = nowIso();
				await this.writeState(auth);
				return Response.json({
					principal: {
						kind: "api_token",
						user: record.user,
						tokenId: record.tokenId,
						label: record.label,
					} satisfies AuthenticatedPrincipal,
				});
			}

			return Response.json({ principal: null });
		}

		if (url.pathname === "/sessions" && request.method === "POST") {
			const session = (await request.json()) as SessionRecord;
			auth.sessionsById[session.sessionId] = session;
			auth.lookupByHash[session.tokenHash] = `session:${session.sessionId}`;
			await this.writeState(auth);
			return Response.json({ ok: true });
		}

		const deleteSession = url.pathname.match(/^\/sessions\/([^/]+)$/);
		if (deleteSession && request.method === "DELETE") {
			const sessionId = decodeURIComponent(deleteSession[1] ?? "");
			const session = auth.sessionsById[sessionId];
			if (!session) return Response.json({ ok: false });
			delete auth.sessionsById[sessionId];
			delete auth.lookupByHash[session.tokenHash];
			await this.writeState(auth);
			return Response.json({ ok: true });
		}

		if (url.pathname === "/tokens" && request.method === "GET") {
			const userId = Number(url.searchParams.get("userId"));
			const tokens = Object.values(auth.tokensById)
				.filter((token) => token.user.id === userId && !token.revokedAt)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
				.map(publicTokenView);
			return Response.json({ tokens });
		}

		if (url.pathname === "/tokens" && request.method === "POST") {
			const record = (await request.json()) as ApiTokenRecord;
			auth.tokensById[record.tokenId] = record;
			auth.lookupByHash[record.tokenHash] = `token:${record.tokenId}`;
			await this.writeState(auth);
			return Response.json({ ok: true });
		}

		const deleteToken = url.pathname.match(/^\/tokens\/([^/]+)$/);
		if (deleteToken && request.method === "DELETE") {
			const tokenId = decodeURIComponent(deleteToken[1] ?? "");
			const body = (await request.json()) as { userId: number };
			const record = auth.tokensById[tokenId];
			if (!record || record.user.id !== body.userId || record.revokedAt) {
				return Response.json({ ok: false });
			}
			record.revokedAt = nowIso();
			delete auth.lookupByHash[record.tokenHash];
			await this.writeState(auth);
			return Response.json({ ok: true });
		}

		return new Response("Not found", { status: 404 });
	}
}
