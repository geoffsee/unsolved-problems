import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetLocalAuthStateForTests } from "./auth";
import app, { makeProblemId, resetLocalRuntimeStateForTests } from "./main";

const SAMPLE_PROBLEMS = {
	categories: {
		astronomy: [
			{
				heading: "Black holes",
				problems: ["Why is information preserved in black holes?"],
			},
			{
				heading: "Cosmology",
				problems: ["What is dark energy?"],
			},
		],
		biology: [
			{
				heading: "Origin of life",
				problems: ["How did life begin on Earth?"],
			},
		],
		chemistry: [
			{
				heading: "Catalysis",
				problems: ["How does enzyme catalysis achieve rate enhancement?"],
			},
		],
	},
};

const SAMPLE_ENRICHMENTS = {
	problems: {
		"Why is information preserved in black holes?": {
			summary: "The black hole information paradox.",
			significance: "Quantum gravity.",
		},
	},
};

const ASTRONOMY_BLACK_HOLES_ID = makeProblemId(
	"astronomy",
	"Black holes",
	"Why is information preserved in black holes?",
);
const BIOLOGY_ID = makeProblemId(
	"biology",
	"Origin of life",
	"How did life begin on Earth?",
);
const CHEMISTRY_ID = makeProblemId(
	"chemistry",
	"Catalysis",
	"How does enzyme catalysis achieve rate enhancement?",
);

let tempDir: string;
let originalFetch: typeof fetch;
let previousStatePath: string | undefined;
let previousAuthPath: string | undefined;
let previousAuthDisabled: string | undefined;

function emptyQueueFile(path: string) {
	writeFileSync(
		path,
		JSON.stringify({
			claimsByProblemId: {},
			solutionsByProblemId: {},
			researchEntriesByProblemId: {},
		}),
	);
}

function installFetchMock() {
	originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("/data/problems.json")) {
			return new Response(JSON.stringify(SAMPLE_PROBLEMS), { status: 200 });
		}
		if (url.includes("/data/enrichments.json")) {
			return new Response(JSON.stringify(SAMPLE_ENRICHMENTS), {
				status: 200,
			});
		}
		throw new Error(`Unexpected fetch in test: ${url}`);
	}) as typeof fetch;
}

async function callMcp(method: string, params: Record<string, unknown>) {
	const response = await app.fetch(
		new Request("http://localhost/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				"mcp-protocol-version": "2025-03-26",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method,
				params,
			}),
		}),
	);

	const payload = (await response.json()) as {
		result?: Record<string, unknown>;
		error?: { message?: string };
	};
	expect(response.status).toBe(200);
	if (payload.error) {
		throw new Error(payload.error.message ?? "MCP error");
	}
	return payload.result ?? {};
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
	return callMcp("tools/call", { name, arguments: args });
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "unsolved-api-"));
	const statePath = join(tempDir, "agent-queue.json");
	const authPath = join(tempDir, "auth-store.json");
	emptyQueueFile(statePath);
	writeFileSync(
		authPath,
		JSON.stringify({
			sessionsById: {},
			tokensById: {},
			lookupByHash: {},
		}),
	);
	previousStatePath = process.env.UNSOLVED_STATE_PATH;
	previousAuthPath = process.env.UNSOLVED_AUTH_PATH;
	previousAuthDisabled = process.env.AUTH_DISABLED;
	process.env.UNSOLVED_STATE_PATH = statePath;
	process.env.UNSOLVED_AUTH_PATH = authPath;
	// Existing MCP tool tests focus on queue behavior, not OAuth.
	process.env.AUTH_DISABLED = "1";
	resetLocalRuntimeStateForTests();
	resetLocalAuthStateForTests();
	installFetchMock();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (previousStatePath === undefined) {
		delete process.env.UNSOLVED_STATE_PATH;
	} else {
		process.env.UNSOLVED_STATE_PATH = previousStatePath;
	}
	if (previousAuthPath === undefined) {
		delete process.env.UNSOLVED_AUTH_PATH;
	} else {
		process.env.UNSOLVED_AUTH_PATH = previousAuthPath;
	}
	if (previousAuthDisabled === undefined) {
		delete process.env.AUTH_DISABLED;
	} else {
		process.env.AUTH_DISABLED = previousAuthDisabled;
	}
	resetLocalRuntimeStateForTests();
	resetLocalAuthStateForTests();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("HTTP surface", () => {
	test("root advertises MCP tools including list_problems and pick_problem", async () => {
		const response = await app.fetch(new Request("http://localhost/"));
		const body = (await response.json()) as {
			mcp: { tools: string[] };
		};
		expect(response.status).toBe(200);
		expect(body.mcp.tools).toContain("list_problems");
		expect(body.mcp.tools).toContain("pick_problem");
		expect(body.mcp.tools).toContain("list_claims");
	});

	test("health reports ok with zero active claims on empty queue", async () => {
		const response = await app.fetch(new Request("http://localhost/health"));
		const body = (await response.json()) as {
			ok: boolean;
			activeClaims: number;
		};
		expect(body.ok).toBe(true);
		expect(body.activeClaims).toBe(0);
	});

	test("queue snapshot starts empty", async () => {
		const response = await app.fetch(new Request("http://localhost/queue"));
		const body = (await response.json()) as {
			activeClaims: unknown[];
			submissions: unknown[];
		};
		expect(body.activeClaims).toEqual([]);
		expect(body.submissions).toEqual([]);
	});
});

describe("list_problems MCP tool", () => {
	test("returns structuredContent.categories for the full available set", async () => {
		const result = await callTool("list_problems", {
			status: "available",
			limit: 25,
		});

		const structured = result.structuredContent as {
			items: Array<{ id: string; category: string; status: string }>;
			totalMatched: number;
			categories: Record<string, number>;
		};

		expect(structured.totalMatched).toBe(4);
		expect(structured.categories).toEqual({
			astronomy: 2,
			biology: 1,
			chemistry: 1,
		});
		expect(structured.items.every((item) => item.status === "available")).toBe(
			true,
		);
		// Alphabetical catalog order puts astronomy first without a category filter.
		expect(structured.items[0]?.category).toBe("astronomy");

		const content = result.content as Array<{ type: string; text: string }>;
		expect(content[0]?.text).toContain(ASTRONOMY_BLACK_HOLES_ID);
		expect(content[0]?.text).toContain("[available]");
	});

	test("category filter scopes items and category counts", async () => {
		const result = await callTool("list_problems", {
			category: "biology",
			status: "available",
			limit: 10,
		});

		const structured = result.structuredContent as {
			items: Array<{ id: string; category: string }>;
			totalMatched: number;
			categories: Record<string, number>;
		};

		expect(structured.totalMatched).toBe(1);
		expect(structured.items).toHaveLength(1);
		expect(structured.items[0]?.id).toBe(BIOLOGY_ID);
		expect(structured.categories).toEqual({ biology: 1 });
	});

	test("category filter is case-insensitive", async () => {
		const result = await callTool("list_problems", {
			category: "CHEMISTRY",
			status: "available",
		});
		const structured = result.structuredContent as {
			items: Array<{ id: string }>;
			categories: Record<string, number>;
		};
		expect(structured.items.map((item) => item.id)).toEqual([CHEMISTRY_ID]);
		expect(structured.categories).toEqual({ chemistry: 1 });
	});

	test("query filter matches enrichment text", async () => {
		const result = await callTool("list_problems", {
			query: "information paradox",
			status: "all",
		});
		const structured = result.structuredContent as {
			items: Array<{ id: string }>;
			totalMatched: number;
		};
		expect(structured.totalMatched).toBe(1);
		expect(structured.items[0]?.id).toBe(ASTRONOMY_BLACK_HOLES_ID);
	});

	test("respects limit while totalMatched reflects full filtered set", async () => {
		const result = await callTool("list_problems", {
			status: "available",
			limit: 1,
		});
		const structured = result.structuredContent as {
			items: unknown[];
			totalMatched: number;
			categories: Record<string, number>;
		};
		expect(structured.items).toHaveLength(1);
		expect(structured.totalMatched).toBe(4);
		// categories is computed from the full filtered set, not the limited page.
		expect(structured.categories).toEqual({
			astronomy: 2,
			biology: 1,
			chemistry: 1,
		});
	});

	test("returns a no-match message when filters empty the set", async () => {
		const result = await callTool("list_problems", {
			category: "philosophy",
			status: "available",
		});
		const content = result.content as Array<{ text: string }>;
		const structured = result.structuredContent as {
			items: unknown[];
			totalMatched: number;
			categories: Record<string, number>;
		};
		expect(content[0]?.text).toBe("No problems matched the current filters.");
		expect(structured.items).toEqual([]);
		expect(structured.totalMatched).toBe(0);
		expect(structured.categories).toEqual({});
	});
});

describe("pick_problem MCP tool", () => {
	test("claims a specific available problemId", async () => {
		const result = await callTool("pick_problem", {
			agentId: "  test-agent  ",
			problemId: BIOLOGY_ID,
			leaseMinutes: 15,
			notes: "  unit test claim  ",
		});

		const structured = result.structuredContent as {
			claim: {
				claimId: string;
				problemId: string;
				agentId: string;
				status: string;
				notes: string | null;
			};
			problem: { id: string; status: string };
		};

		expect(structured.claim.problemId).toBe(BIOLOGY_ID);
		expect(structured.claim.agentId).toBe("test-agent");
		expect(structured.claim.status).toBe("active");
		expect(structured.claim.notes).toBe("unit test claim");
		expect(structured.problem.status).toBe("claimed");
		expect(structured.claim.claimId.startsWith("claim_")).toBe(true);

		const content = result.content as Array<{ text: string }>;
		expect(content[0]?.text).toContain(`Claimed ${BIOLOGY_ID}`);
		expect(result.isError).toBeUndefined();

		const queue = (await (
			await app.fetch(new Request("http://localhost/queue"))
		).json()) as { activeClaims: Array<{ problemId: string }> };
		expect(queue.activeClaims.map((c) => c.problemId)).toEqual([BIOLOGY_ID]);
	});

	test("auto-picks first available match for category/query", async () => {
		const result = await callTool("pick_problem", {
			agentId: "auto-agent",
			category: "chemistry",
		});
		const structured = result.structuredContent as {
			claim: { problemId: string };
		};
		expect(structured.claim.problemId).toBe(CHEMISTRY_ID);
	});

	test("errors on unknown problemId", async () => {
		const result = await callTool("pick_problem", {
			agentId: "agent",
			problemId: "does-not-exist",
		});
		const content = result.content as Array<{ text: string }>;
		expect(result.isError).toBe(true);
		expect(content[0]?.text).toContain("Unknown or unavailable problemId");
	});

	test("errors when problem is already claimed", async () => {
		await callTool("pick_problem", {
			agentId: "first-agent",
			problemId: BIOLOGY_ID,
		});

		const result = await callTool("pick_problem", {
			agentId: "second-agent",
			problemId: BIOLOGY_ID,
		});
		const content = result.content as Array<{ text: string }>;
		const structured = result.structuredContent as {
			claim: { agentId: string };
		};

		expect(result.isError).toBe(true);
		expect(content[0]?.text).toContain("already claimed by first-agent");
		expect(structured.claim.agentId).toBe("first-agent");
	});

	test("errors when no available problem matches filters", async () => {
		const result = await callTool("pick_problem", {
			agentId: "agent",
			category: "philosophy",
		});
		const content = result.content as Array<{ text: string }>;
		expect(result.isError).toBe(true);
		expect(content[0]?.text).toBe("No available problem matched the request.");
	});

	test("errors when problem already has a submission", async () => {
		const pick = await callTool("pick_problem", {
			agentId: "submitter",
			problemId: CHEMISTRY_ID,
		});
		const claimId = (pick.structuredContent as { claim: { claimId: string } })
			.claim.claimId;

		const submit = await callTool("submit_solution", {
			claimId,
			agentId: "submitter",
			title: "Candidate solution",
			summary: "Candidate write-up with enough detail.",
			approach: "Stepwise method.",
			evidence: "Cited results.",
		});
		expect(submit.isError).toBeUndefined();

		const result = await callTool("pick_problem", {
			agentId: "another",
			problemId: CHEMISTRY_ID,
		});
		const content = result.content as Array<{ text: string }>;
		expect(result.isError).toBe(true);
		expect(content[0]?.text).toContain("already has a submitted solution");
	});
});

describe("catalog resource and claims listing", () => {
	test("reads unsolved://catalog with category inventory", async () => {
		const result = await callMcp("resources/read", {
			uri: "unsolved://catalog",
		});
		const contents = result.contents as Array<{ text?: string }>;
		const catalog = JSON.parse(contents[0]?.text ?? "{}") as {
			totalProblems: number;
			availableProblems: number;
			categories: Record<string, number>;
		};
		expect(catalog.totalProblems).toBe(4);
		expect(catalog.availableProblems).toBe(4);
		expect(catalog.categories.astronomy).toBe(2);
		expect(catalog.categories.biology).toBe(1);
	});

	test("list_claims reflects active claims after pick", async () => {
		await callTool("pick_problem", {
			agentId: "claims-agent",
			problemId: BIOLOGY_ID,
		});

		const result = await callTool("list_claims", {
			status: "active",
			agentId: "claims-agent",
		});
		const structured = result.structuredContent as {
			claims: Array<{ problemId: string; agentId: string; status: string }>;
		};
		expect(structured.claims).toHaveLength(1);
		expect(structured.claims[0]).toMatchObject({
			problemId: BIOLOGY_ID,
			agentId: "claims-agent",
			status: "active",
		});
	});

	test("list_problems status=claimed reflects active leases", async () => {
		await callTool("pick_problem", {
			agentId: "claims-agent",
			problemId: BIOLOGY_ID,
		});

		const claimed = await callTool("list_problems", {
			status: "claimed",
		});
		const structured = claimed.structuredContent as {
			items: Array<{ id: string; status: string }>;
			categories: Record<string, number>;
		};
		expect(structured.items.map((item) => item.id)).toEqual([BIOLOGY_ID]);
		expect(structured.items[0]?.status).toBe("claimed");
		expect(structured.categories).toEqual({ biology: 1 });

		const available = await callTool("list_problems", {
			status: "available",
			category: "biology",
		});
		const availableStructured = available.structuredContent as {
			totalMatched: number;
		};
		expect(availableStructured.totalMatched).toBe(0);
	});
});

describe("problem detail HTTP routes", () => {
	test("returns 404 for unknown problem", async () => {
		const response = await app.fetch(
			new Request("http://localhost/problems/missing-id"),
		);
		expect(response.status).toBe(404);
		const body = (await response.json()) as { error: string };
		expect(body.error).toContain("Unknown problemId");
	});

	test("returns problem detail with enrichment", async () => {
		const response = await app.fetch(
			new Request(`http://localhost/problems/${ASTRONOMY_BLACK_HOLES_ID}`),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			id: string;
			status: string;
			enrichment: { summary?: string } | null;
		};
		expect(body.id).toBe(ASTRONOMY_BLACK_HOLES_ID);
		expect(body.status).toBe("available");
		expect(body.enrichment?.summary).toContain("information paradox");
	});
});
