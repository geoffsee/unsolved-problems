import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createApiToken,
	createOAuthState,
	createSession,
	getGithubClientId,
	isContributionAuthRequired,
	isSafeReturnTo,
	parseBearerToken,
	requireContributionAuth,
	resetLocalAuthStateForTests,
	resolvePrincipal,
	revokeApiToken,
	sanitizeSecretValue,
	sha256Hex,
	verifyOAuthState,
} from "./auth";
import app, { resetLocalRuntimeStateForTests } from "./main";

let tempDir: string;
let previousAuthPath: string | undefined;
let previousStatePath: string | undefined;
let previousAuthDisabled: string | undefined;
let previousContributionRequired: string | undefined;
let previousGithubId: string | undefined;
let previousGithubSecret: string | undefined;
let previousAllowDev: string | undefined;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "unsolved-auth-"));
	const authPath = join(tempDir, "auth-store.json");
	const statePath = join(tempDir, "agent-queue.json");
	writeFileSync(
		authPath,
		JSON.stringify({
			sessionsById: {},
			tokensById: {},
			lookupByHash: {},
		}),
	);
	writeFileSync(
		statePath,
		JSON.stringify({
			claimsByProblemId: {},
			solutionsByProblemId: {},
			researchEntriesByProblemId: {},
		}),
	);
	previousAuthPath = process.env.OPEN_QUESTIONS_AUTH_PATH;
	previousStatePath = process.env.OPEN_QUESTIONS_STATE_PATH;
	previousAuthDisabled = process.env.AUTH_DISABLED;
	previousContributionRequired = process.env.CONTRIBUTION_AUTH_REQUIRED;
	previousGithubId = process.env.GITHUB_CLIENT_ID;
	previousGithubSecret = process.env.GITHUB_CLIENT_SECRET;
	previousAllowDev = process.env.ALLOW_DEV_AUTH;
	process.env.OPEN_QUESTIONS_AUTH_PATH = authPath;
	process.env.OPEN_QUESTIONS_STATE_PATH = statePath;
	delete process.env.AUTH_DISABLED;
	delete process.env.GITHUB_CLIENT_ID;
	delete process.env.GITHUB_CLIENT_SECRET;
	process.env.CONTRIBUTION_AUTH_REQUIRED = "1";
	process.env.ALLOW_DEV_AUTH = "1";
	resetLocalAuthStateForTests();
	resetLocalRuntimeStateForTests();
});

afterEach(() => {
	const restore = (key: string, value: string | undefined) => {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	};
	restore("OPEN_QUESTIONS_AUTH_PATH", previousAuthPath);
	restore("OPEN_QUESTIONS_STATE_PATH", previousStatePath);
	restore("AUTH_DISABLED", previousAuthDisabled);
	restore("CONTRIBUTION_AUTH_REQUIRED", previousContributionRequired);
	restore("GITHUB_CLIENT_ID", previousGithubId);
	restore("GITHUB_CLIENT_SECRET", previousGithubSecret);
	restore("ALLOW_DEV_AUTH", previousAllowDev);
	resetLocalAuthStateForTests();
	resetLocalRuntimeStateForTests();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("auth helpers", () => {
	test("sanitizeSecretValue strips paste accidents", () => {
		expect(sanitizeSecretValue("=Ov23liJhRdxYFM11LxMx")).toBe(
			"Ov23liJhRdxYFM11LxMx",
		);
		expect(sanitizeSecretValue('  "secret"  ')).toBe("secret");
		expect(sanitizeSecretValue("  plain  ")).toBe("plain");
		expect(sanitizeSecretValue(null)).toBe("");
	});

	test("getGithubClientId normalizes env values", () => {
		process.env.GITHUB_CLIENT_ID = "=Ov23liJhRdxYFM11LxMx";
		expect(getGithubClientId()).toBe("Ov23liJhRdxYFM11LxMx");
	});

	test("parseBearerToken extracts the credential", () => {
		expect(
			parseBearerToken(
				new Request("http://localhost", {
					headers: { authorization: "Bearer  abc.def  " },
				}),
			),
		).toBe("abc.def");
		expect(parseBearerToken(new Request("http://localhost"))).toBeNull();
	});

	test("isSafeReturnTo allows pages origin and localhost", () => {
		expect(isSafeReturnTo("https://geoffsee.github.io/open-questions/")).toBe(
			true,
		);
		expect(isSafeReturnTo("http://localhost:3000/")).toBe(true);
		expect(isSafeReturnTo("https://evil.example/phish")).toBe(false);
	});

	test("oauth state round-trips", async () => {
		process.env.GITHUB_CLIENT_SECRET = "test-secret";
		const state = await createOAuthState(
			"https://geoffsee.github.io/open-questions/",
		);
		await expect(verifyOAuthState(state)).resolves.toBe(
			"https://geoffsee.github.io/open-questions/",
		);
		await expect(verifyOAuthState(`${state}tampered`)).resolves.toBeNull();
	});

	test("sha256 is stable", async () => {
		expect(await sha256Hex("token")).toBe(await sha256Hex("token"));
		expect(await sha256Hex("token")).not.toBe(await sha256Hex("other"));
	});

	test("requireContributionAuth accepts only api tokens when required", () => {
		expect(isContributionAuthRequired()).toBe(true);
		expect(
			requireContributionAuth({
				kind: "api_token",
				user: { id: 1, login: "a", name: null, avatarUrl: null },
				tokenId: "tok_1",
			}),
		).toMatchObject({ kind: "api_token" });
		expect(
			requireContributionAuth({
				kind: "session",
				user: { id: 1, login: "a", name: null, avatarUrl: null },
				sessionId: "sess_1",
			}),
		).toBeNull();
		expect(requireContributionAuth(null)).toBeNull();
	});
});

describe("token lifecycle", () => {
	test("create, resolve, and revoke API tokens", async () => {
		const user = {
			id: 42,
			login: "geoffsee",
			name: "Geoff",
			avatarUrl: "https://example.com/a.png",
		};
		const { token, record } = await createApiToken(user, "CI agent");
		expect(token.startsWith("up_live_")).toBe(true);
		expect(record.tokenPrefix.startsWith("up_live_")).toBe(true);

		const principal = await resolvePrincipal(
			new Request("http://localhost", {
				headers: { authorization: `Bearer ${token}` },
			}),
		);
		expect(principal).toMatchObject({
			kind: "api_token",
			tokenId: record.tokenId,
			user: { login: "geoffsee" },
		});

		const revoked = await revokeApiToken(record.tokenId, user.id);
		expect(revoked).toBe(true);
		await expect(
			resolvePrincipal(
				new Request("http://localhost", {
					headers: { authorization: `Bearer ${token}` },
				}),
			),
		).resolves.toBeNull();
	});

	test("session tokens resolve but are not contribution credentials", async () => {
		const user = {
			id: 7,
			login: "researcher",
			name: null,
			avatarUrl: null,
		};
		const { sessionToken } = await createSession(user);
		const principal = await resolvePrincipal(
			new Request("http://localhost", {
				headers: { authorization: `Bearer ${sessionToken}` },
			}),
		);
		expect(principal?.kind).toBe("session");
		expect(requireContributionAuth(principal)).toBeNull();
	});
});

describe("auth HTTP + MCP enforcement", () => {
	test("dev token endpoint mints a usable bearer token", async () => {
		const response = await app.fetch(
			new Request("http://localhost/auth/dev/token", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ label: "unit", login: "tester" }),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { token: string };
		expect(body.token.startsWith("up_live_")).toBe(true);

		const me = await app.fetch(
			new Request("http://localhost/auth/me", {
				headers: { authorization: `Bearer ${body.token}` },
			}),
		);
		expect(me.status).toBe(200);
		const meBody = (await me.json()) as { user: { login: string } };
		expect(meBody.user.login).toBe("tester");
	});

	test("pick_problem requires bearer API token when auth is required", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/data/problems.json")) {
				return new Response(
					JSON.stringify({
						categories: {
							biology: [
								{
									heading: "Origin",
									problems: ["How did life begin?"],
								},
							],
						},
					}),
					{ status: 200 },
				);
			}
			if (url.includes("/data/enrichments.json")) {
				return new Response(JSON.stringify({ problems: {} }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		}) as typeof fetch;

		try {
			const unauth = await app.fetch(
				new Request("http://localhost/mcp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: {
							name: "pick_problem",
							arguments: { agentId: "agent", category: "biology" },
						},
					}),
				}),
			);
			const unauthBody = (await unauth.json()) as {
				result: { isError?: boolean; content: Array<{ text: string }> };
			};
			expect(unauthBody.result.isError).toBe(true);
			expect(unauthBody.result.content[0]?.text).toContain(
				"Authentication required",
			);

			const mint = await app.fetch(
				new Request("http://localhost/auth/dev/token", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ label: "mcp", login: "agent-user" }),
				}),
			);
			const { token } = (await mint.json()) as { token: string };

			const auth = await app.fetch(
				new Request("http://localhost/mcp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 2,
						method: "tools/call",
						params: {
							name: "pick_problem",
							arguments: { agentId: "agent", category: "biology" },
						},
					}),
				}),
			);
			const authBody = (await auth.json()) as {
				result: {
					isError?: boolean;
					content?: Array<{ text?: string }>;
					structuredContent?: { claim?: { notes?: string | null } };
				};
			};
			expect(authBody.result.content?.[0]?.text ?? "").not.toContain(
				"Authentication required",
			);
			expect(authBody.result.isError).toBeUndefined();
			expect(authBody.result.structuredContent?.claim?.notes).toContain(
				"github:agent-user",
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("session bearer cannot create contribution claims", async () => {
		const user = {
			id: 9,
			login: "web-user",
			name: null,
			avatarUrl: null,
		};
		const { sessionToken } = await createSession(user);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/data/problems.json")) {
				return new Response(
					JSON.stringify({
						categories: {
							biology: [
								{ heading: "Origin", problems: ["How did life begin?"] },
							],
						},
					}),
					{ status: 200 },
				);
			}
			if (url.includes("/data/enrichments.json")) {
				return new Response(JSON.stringify({ problems: {} }), { status: 200 });
			}
			throw new Error(`Unexpected fetch: ${url}`);
		}) as typeof fetch;

		try {
			const response = await app.fetch(
				new Request("http://localhost/mcp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
						authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: {
							name: "pick_problem",
							arguments: { agentId: "agent", category: "biology" },
						},
					}),
				}),
			);
			const body = (await response.json()) as {
				result: { isError?: boolean };
			};
			expect(body.result.isError).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
