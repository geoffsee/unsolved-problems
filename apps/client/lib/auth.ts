import { AGENT_RESEARCH_API_ORIGIN } from "./agentResearch";

const SESSION_STORAGE_KEY = "unsolved.auth.session";

export type AuthUser = {
	id: number;
	login: string;
	name: string | null;
	avatarUrl: string | null;
};

export type AuthMe = {
	authenticated: boolean;
	kind: "session" | "api_token";
	user: AuthUser;
	tokenId: string | null;
	sessionId: string | null;
	label: string | null;
	contributionAuthRequired: boolean;
};

export type AuthConfig = {
	githubConfigured: boolean;
	localAuthEnabled: boolean;
	contributionAuthRequired: boolean;
};

export type ApiTokenSummary = {
	tokenId: string;
	tokenPrefix: string;
	label: string;
	createdAt: string;
	lastUsedAt: string | null;
	user: AuthUser;
};

export type CreatedApiToken = {
	token: string;
	tokenId: string;
	tokenPrefix: string;
	label: string;
	createdAt: string;
	warning: string;
};

export type LocalAuthSession = {
	sessionToken: string;
	expiresAt: string;
	user: AuthUser;
};

export function getStoredSessionToken(): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(SESSION_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function storeSessionToken(token: string) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(SESSION_STORAGE_KEY, token);
}

export function clearSessionToken() {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

/** Capture `#auth_session=...` from the OAuth redirect and persist it. */
export function captureOAuthSessionFromHash(): string | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash.replace(/^#/, "");
	if (!hash) return null;

	const params = new URLSearchParams(hash);
	const session = params.get("auth_session");
	if (!session) return null;

	storeSessionToken(session);
	// Remove the token from the URL bar without reloading.
	const url = new URL(window.location.href);
	url.hash = "";
	window.history.replaceState(null, "", url.toString());
	return session;
}

export function githubLoginUrl(returnTo?: string): string {
	const target =
		returnTo ||
		(typeof window !== "undefined"
			? window.location.href.split("#")[0]
			: `${AGENT_RESEARCH_API_ORIGIN}/`);
	const url = new URL(
		`${AGENT_RESEARCH_API_ORIGIN}/auth/github`,
		typeof window !== "undefined" ? window.location.origin : undefined,
	);
	url.searchParams.set("return_to", target ?? "");
	return url.toString();
}

async function parseErrorMessage(
	response: Response,
	fallback: string,
): Promise<string> {
	const body = (await response.json().catch(() => null)) as {
		error?: string;
	} | null;
	return body?.error || fallback;
}

async function authFetch(
	path: string,
	init: RequestInit = {},
	token = getStoredSessionToken(),
): Promise<Response> {
	if (!token) {
		throw new Error("Not signed in.");
	}
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${token}`);
	if (init.body && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return fetch(`${AGENT_RESEARCH_API_ORIGIN}${path}`, {
		...init,
		headers,
	});
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
	const response = await fetch(`${AGENT_RESEARCH_API_ORIGIN}/`);
	if (!response.ok) {
		throw new Error(`Auth config failed with ${response.status}`);
	}
	const payload = (await response.json()) as {
		auth?: {
			githubConfigured?: boolean;
			localAuthEnabled?: boolean;
			contributionAuthRequired?: boolean;
		};
	};
	return {
		githubConfigured: Boolean(payload.auth?.githubConfigured),
		localAuthEnabled: payload.auth?.localAuthEnabled !== false,
		contributionAuthRequired: Boolean(payload.auth?.contributionAuthRequired),
	};
}

export async function registerLocalAccount(
	username: string,
	password: string,
	name?: string,
): Promise<LocalAuthSession> {
	const response = await fetch(`${AGENT_RESEARCH_API_ORIGIN}/auth/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			username,
			password,
			...(name?.trim() ? { name: name.trim() } : {}),
		}),
	});
	if (!response.ok) {
		throw new Error(
			await parseErrorMessage(
				response,
				`Registration failed with ${response.status}`,
			),
		);
	}
	const session = (await response.json()) as LocalAuthSession;
	storeSessionToken(session.sessionToken);
	return session;
}

export async function loginLocalAccount(
	username: string,
	password: string,
): Promise<LocalAuthSession> {
	const response = await fetch(`${AGENT_RESEARCH_API_ORIGIN}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
	if (!response.ok) {
		throw new Error(
			await parseErrorMessage(response, `Login failed with ${response.status}`),
		);
	}
	const session = (await response.json()) as LocalAuthSession;
	storeSessionToken(session.sessionToken);
	return session;
}

export async function fetchAuthMe(
	token = getStoredSessionToken(),
): Promise<AuthMe | null> {
	if (!token) return null;
	const response = await authFetch("/auth/me", {}, token);
	if (response.status === 401) {
		clearSessionToken();
		return null;
	}
	if (!response.ok) {
		throw new Error(`Auth check failed with ${response.status}`);
	}
	return response.json();
}

export async function fetchApiTokens(): Promise<ApiTokenSummary[]> {
	const response = await authFetch("/auth/tokens");
	if (!response.ok) {
		throw new Error(`Token list failed with ${response.status}`);
	}
	const payload = (await response.json()) as { tokens?: ApiTokenSummary[] };
	return payload.tokens ?? [];
}

export async function createApiToken(label: string): Promise<CreatedApiToken> {
	const response = await authFetch("/auth/tokens", {
		method: "POST",
		body: JSON.stringify({ label }),
	});
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			error?: string;
		} | null;
		throw new Error(
			body?.error || `Token create failed with ${response.status}`,
		);
	}
	return response.json();
}

export async function revokeApiToken(tokenId: string): Promise<void> {
	const response = await authFetch(
		`/auth/tokens/${encodeURIComponent(tokenId)}`,
		{
			method: "DELETE",
		},
	);
	if (!response.ok) {
		throw new Error(`Token revoke failed with ${response.status}`);
	}
}

export async function logoutSession(): Promise<void> {
	try {
		await authFetch("/auth/logout", { method: "POST" });
	} catch {
		// clear local session even if API is unreachable
	}
	clearSessionToken();
}
