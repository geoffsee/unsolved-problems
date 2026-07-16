import { fileURLToPath } from "node:url";
import { JsonFileStateStore, type StateStore } from "./persistence";

export type AuthBindings = {
	PAGES_ORIGIN?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	AUTH_DISABLED?: string;
	CONTRIBUTION_AUTH_REQUIRED?: string;
	ALLOW_DEV_AUTH?: string;
	AUTH_STORE?: DurableObjectNamespace;
};

/** Authenticated identity (GitHub OAuth or local username/password). */
export type AuthUser = {
	id: number;
	login: string;
	name: string | null;
	avatarUrl: string | null;
};

/** @deprecated Prefer AuthUser — kept for call-site compatibility. */
export type GitHubUser = AuthUser;

export type SessionRecord = {
	sessionId: string;
	tokenHash: string;
	user: AuthUser;
	createdAt: string;
	expiresAt: string;
};

export type ApiTokenRecord = {
	tokenId: string;
	tokenHash: string;
	tokenPrefix: string;
	label: string;
	user: AuthUser;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
};

/** Local username/password account. Password material is never returned publicly. */
export type LocalAccountRecord = {
	username: string;
	passwordHash: string;
	passwordSalt: string;
	user: AuthUser;
	createdAt: string;
};

export type AuthStoreState = {
	sessionsById: Record<string, SessionRecord>;
	tokensById: Record<string, ApiTokenRecord>;
	/** sha256(token) -> tokenId or sessionId with kind prefix */
	lookupByHash: Record<string, string>;
	/** lowercase username -> local account */
	accountsByUsername: Record<string, LocalAccountRecord>;
	/** Next numeric id for local users (avoids GitHub id collisions). */
	nextLocalUserId: number;
};

export type AuthenticatedPrincipal = {
	kind: "session" | "api_token";
	user: AuthUser;
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
	user: Pick<AuthUser, "id" | "login" | "name" | "avatarUrl">;
};

export type LocalAuthValidationError = {
	ok: false;
	status: 400 | 409 | 401;
	error: string;
};

export type LocalAuthSuccess = {
	ok: true;
	user: AuthUser;
	sessionToken: string;
	session: SessionRecord;
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
/** Local account ids start here so they do not collide with typical GitHub user ids. */
export const LOCAL_USER_ID_BASE = 1_000_000_000;
const PBKDF2_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BITS = 256;
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,31}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

let authStore: StateStore<AuthStoreState> | undefined;

export function emptyAuthState(): AuthStoreState {
	return {
		sessionsById: {},
		tokensById: {},
		lookupByHash: {},
		accountsByUsername: {},
		nextLocalUserId: LOCAL_USER_ID_BASE,
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

/** Normalize partial/legacy auth blobs (missing local-account fields). */
export function normalizeAuthState(
	state: Partial<AuthStoreState> | null | undefined,
): AuthStoreState {
	const base = emptyAuthState();
	if (!state) return base;
	return {
		sessionsById: state.sessionsById ?? base.sessionsById,
		tokensById: state.tokensById ?? base.tokensById,
		lookupByHash: state.lookupByHash ?? base.lookupByHash,
		accountsByUsername: state.accountsByUsername ?? base.accountsByUsername,
		nextLocalUserId:
			typeof state.nextLocalUserId === "number" &&
			Number.isFinite(state.nextLocalUserId)
				? state.nextLocalUserId
				: base.nextLocalUserId,
	};
}

export function cloneAuthState(state: AuthStoreState): AuthStoreState {
	const normalized = normalizeAuthState(state);
	return {
		sessionsById: Object.fromEntries(
			Object.entries(normalized.sessionsById).map(([key, value]) => [
				key,
				{ ...value, user: { ...value.user } },
			]),
		),
		tokensById: Object.fromEntries(
			Object.entries(normalized.tokensById).map(([key, value]) => [
				key,
				{ ...value, user: { ...value.user } },
			]),
		),
		lookupByHash: { ...normalized.lookupByHash },
		accountsByUsername: Object.fromEntries(
			Object.entries(normalized.accountsByUsername).map(([key, value]) => [
				key,
				{ ...value, user: { ...value.user } },
			]),
		),
		nextLocalUserId: normalized.nextLocalUserId,
	};
}

function getAuthStore(): StateStore<AuthStoreState> {
	if (!authStore) {
		authStore = new JsonFileStateStore(
			getLocalAuthPath(),
			emptyAuthState(),
			cloneAuthState,
		);
	}
	return authStore;
}

function readLocalAuthState(): AuthStoreState {
	return getAuthStore().read();
}

function writeLocalAuthState(state: AuthStoreState) {
	getAuthStore().write(state);
}

/** Override local persistence, for example with a database-backed Bun store. */
export function configureAuthStore(store: StateStore<AuthStoreState>) {
	authStore = store;
}

export function resetLocalAuthStateForTests() {
	authStore = new JsonFileStateStore(
		getLocalAuthPath(),
		emptyAuthState(),
		cloneAuthState,
	);
	authStore.write(emptyAuthState());
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
 * Contribution (write) tools require a Bearer API token once a login method can
 * mint tokens: GitHub OAuth is configured, local accounts are available (default),
 * or CONTRIBUTION_AUTH_REQUIRED=1. Public catalog reads stay open. Tests can set
 * AUTH_DISABLED=1 or CONTRIBUTION_AUTH_REQUIRED=0.
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
	// Either GitHub OAuth or local username/password can issue contribution tokens.
	return Boolean(getGithubClientId(env)) || isLocalAuthEnabled(env);
}

/** Local username/password auth is available unless AUTH_DISABLED=1. */
export function isLocalAuthEnabled(env?: AuthBindings) {
	return !isAuthDisabled(env);
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
	return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.trim();
	if (clean.length % 2 !== 0) {
		throw new Error("Invalid hex string.");
	}
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i += 1) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

function randomToken(bytes = 32): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return bytesToHex(buffer);
}

export function normalizeUsername(username: string): string {
	return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
	const trimmed = username.trim();
	if (!trimmed) return "Username is required.";
	if (!USERNAME_PATTERN.test(trimmed)) {
		return "Username must be 3–32 characters, start with a letter or number, and contain only letters, numbers, underscores, or hyphens.";
	}
	return null;
}

export function validatePassword(password: string): string | null {
	if (typeof password !== "string" || !password) {
		return "Password is required.";
	}
	if (password.length < MIN_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
	}
	if (password.length > MAX_PASSWORD_LENGTH) {
		return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
	}
	return null;
}

export async function hashPassword(
	password: string,
	saltHex?: string,
): Promise<{ hash: string; salt: string }> {
	const salt = saltHex
		? hexToBytes(saltHex)
		: crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		key,
		PASSWORD_HASH_BITS,
	);
	return {
		salt: bytesToHex(salt instanceof Uint8Array ? salt : new Uint8Array(salt)),
		hash: bytesToHex(new Uint8Array(bits)),
	};
}

export async function verifyPassword(
	password: string,
	salt: string,
	expectedHash: string,
): Promise<boolean> {
	try {
		const { hash } = await hashPassword(password, salt);
		return timingSafeEqualHex(hash, expectedHash);
	} catch {
		return false;
	}
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
	user: AuthUser,
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
	user: AuthUser,
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

function publicUserView(user: AuthUser): AuthUser {
	return {
		id: user.id,
		login: user.login,
		name: user.name,
		avatarUrl: user.avatarUrl,
	};
}

async function readAccountByUsername(
	username: string,
	env?: AuthBindings,
): Promise<LocalAccountRecord | null> {
	const key = normalizeUsername(username);
	if (!key) return null;

	if (env?.AUTH_STORE) {
		const result = (await callAuthObject(
			env,
			`/accounts/${encodeURIComponent(key)}`,
		)) as { account: LocalAccountRecord | null };
		return result.account;
	}

	const state = readLocalAuthState();
	return state.accountsByUsername[key] ?? null;
}

async function createLocalAccountRecord(
	input: {
		username: string;
		passwordHash: string;
		passwordSalt: string;
		name: string | null;
	},
	env?: AuthBindings,
): Promise<
	{ ok: true; account: LocalAccountRecord } | { ok: false; error: string }
> {
	if (env?.AUTH_STORE) {
		const id = env.AUTH_STORE?.idFromName("global");
		const stub = id && env.AUTH_STORE?.get(id);
		if (!stub) {
			throw new Error("AUTH_STORE Durable Object binding is not configured.");
		}
		const response = await stub.fetch("https://auth-store.internal/accounts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		});
		if (response.status === 409) {
			return { ok: false, error: "That username is already taken." };
		}
		if (!response.ok) {
			const message = await response.text();
			throw new Error(
				message || `Auth store request failed with ${response.status}.`,
			);
		}
		const result = (await response.json()) as { account: LocalAccountRecord };
		return { ok: true, account: result.account };
	}

	const state = readLocalAuthState();
	const key = normalizeUsername(input.username);
	if (state.accountsByUsername[key]) {
		return { ok: false, error: "That username is already taken." };
	}
	const userId = state.nextLocalUserId;
	state.nextLocalUserId = userId + 1;
	const account: LocalAccountRecord = {
		username: key,
		passwordHash: input.passwordHash,
		passwordSalt: input.passwordSalt,
		user: {
			id: userId,
			login: key,
			name: input.name,
			avatarUrl: null,
		},
		createdAt: nowIso(),
	};
	state.accountsByUsername[key] = account;
	writeLocalAuthState(state);
	return { ok: true, account };
}

/**
 * Create a local username/password account and open a session.
 * Returns structured validation errors for the HTTP layer.
 */
export async function registerLocalAccount(
	input: {
		username: string;
		password: string;
		name?: string | null;
	},
	env?: AuthBindings,
): Promise<LocalAuthSuccess | LocalAuthValidationError> {
	if (!isLocalAuthEnabled(env)) {
		return {
			ok: false,
			status: 400,
			error: "Local authentication is disabled on this API.",
		};
	}

	const usernameError = validateUsername(input.username);
	if (usernameError) {
		return { ok: false, status: 400, error: usernameError };
	}
	const passwordError = validatePassword(input.password);
	if (passwordError) {
		return { ok: false, status: 400, error: passwordError };
	}

	const username = normalizeUsername(input.username);
	const existing = await readAccountByUsername(username, env);
	if (existing) {
		return { ok: false, status: 409, error: "That username is already taken." };
	}

	const { hash, salt } = await hashPassword(input.password);
	const name =
		typeof input.name === "string" && input.name.trim()
			? input.name.trim().slice(0, 80)
			: null;

	const saved = await createLocalAccountRecord(
		{
			username,
			passwordHash: hash,
			passwordSalt: salt,
			name,
		},
		env,
	);
	if (!saved.ok) {
		return { ok: false, status: 409, error: saved.error };
	}

	const { sessionToken, session } = await createSession(
		saved.account.user,
		env,
	);
	return {
		ok: true,
		user: publicUserView(saved.account.user),
		sessionToken,
		session,
	};
}

/**
 * Authenticate a local username/password and open a session.
 * Uses a generic error for bad credentials to avoid user enumeration.
 */
export async function loginLocalAccount(
	input: { username: string; password: string },
	env?: AuthBindings,
): Promise<LocalAuthSuccess | LocalAuthValidationError> {
	if (!isLocalAuthEnabled(env)) {
		return {
			ok: false,
			status: 400,
			error: "Local authentication is disabled on this API.",
		};
	}

	const username = typeof input.username === "string" ? input.username : "";
	const password = typeof input.password === "string" ? input.password : "";
	if (!username.trim() || !password) {
		return {
			ok: false,
			status: 400,
			error: "Username and password are required.",
		};
	}

	const account = await readAccountByUsername(username, env);
	const invalid = {
		ok: false as const,
		status: 401 as const,
		error: "Invalid username or password.",
	};
	if (!account) {
		// Dummy hash work to reduce timing differences when the user is missing.
		await hashPassword(password);
		return invalid;
	}

	const valid = await verifyPassword(
		password,
		account.passwordSalt,
		account.passwordHash,
	);
	if (!valid) return invalid;

	const { sessionToken, session } = await createSession(account.user, env);
	return {
		ok: true,
		user: publicUserView(account.user),
		sessionToken,
		session,
	};
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
		"Sign in on the Catalog site (local account or GitHub), create an API token, and send it as Authorization: Bearer <token>.",
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
		const auth = cloneAuthState(normalizeAuthState(stored));
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

		const getAccount = url.pathname.match(/^\/accounts\/([^/]+)$/);
		if (getAccount && request.method === "GET") {
			const username = normalizeUsername(
				decodeURIComponent(getAccount[1] ?? ""),
			);
			return Response.json({
				account: auth.accountsByUsername[username] ?? null,
			});
		}

		if (url.pathname === "/accounts" && request.method === "POST") {
			const body = (await request.json()) as {
				username?: string;
				passwordHash?: string;
				passwordSalt?: string;
				name?: string | null;
			};
			const username = normalizeUsername(body.username ?? "");
			if (
				!username ||
				!body.passwordHash ||
				!body.passwordSalt ||
				typeof body.passwordHash !== "string" ||
				typeof body.passwordSalt !== "string"
			) {
				return Response.json(
					{ error: "Invalid account payload." },
					{ status: 400 },
				);
			}
			if (auth.accountsByUsername[username]) {
				return Response.json(
					{ error: "That username is already taken." },
					{ status: 409 },
				);
			}
			const userId = auth.nextLocalUserId;
			auth.nextLocalUserId = userId + 1;
			const account: LocalAccountRecord = {
				username,
				passwordHash: body.passwordHash,
				passwordSalt: body.passwordSalt,
				user: {
					id: userId,
					login: username,
					name:
						typeof body.name === "string" && body.name.trim()
							? body.name.trim().slice(0, 80)
							: null,
					avatarUrl: null,
				},
				createdAt: nowIso(),
			};
			auth.accountsByUsername[username] = account;
			await this.writeState(auth);
			return Response.json({ account });
		}

		return new Response("Not found", { status: 404 });
	}
}
