import { describe, expect, test } from "bun:test";
import {
	cloneQueueState,
	createCatalogSummary,
	createClaimRecord,
	createQueueSnapshot,
	createResearchEntryRecord,
	createSubmissionRecord,
	filterProblems,
	hasUrl,
	isAllowedPath,
	isUsageResearchEntry,
	makeProblemId,
	normalizeMultilineText,
	normalizeText,
	type ProblemClaim,
	type ProblemRecord,
	pruneExpiredClaims,
	type QueueState,
	type ResearchEntry,
	slugify,
	stableHash,
	substantiveResearchEntries,
} from "./main";

function emptyState(overrides: Partial<QueueState> = {}): QueueState {
	return {
		claimsByProblemId: {},
		solutionsByProblemId: {},
		researchEntriesByProblemId: {},
		...overrides,
	};
}

function problem(
	partial: Partial<ProblemRecord> & Pick<ProblemRecord, "id" | "category">,
): ProblemRecord {
	return {
		section: partial.section ?? "General",
		text: partial.text ?? `Text for ${partial.id}`,
		enrichment: partial.enrichment ?? null,
		...partial,
	};
}

const sampleProblems: ProblemRecord[] = [
	problem({
		id: "astronomy-1",
		category: "astronomy",
		section: "Cosmology",
		text: "What is dark matter?",
		enrichment: { summary: "Missing mass problem", significance: "High" },
	}),
	problem({
		id: "biology-1",
		category: "biology",
		section: "Origin of life",
		text: "How did life begin?",
	}),
	problem({
		id: "chemistry-1",
		category: "chemistry",
		section: "Catalysis",
		text: "Enzyme catalysis at scale",
	}),
	problem({
		id: "computer-science-1",
		category: "computer science",
		section: "Complexity",
		text: "P versus NP",
	}),
];

describe("normalizeText / normalizeMultilineText / hasUrl", () => {
	test("collapses interior whitespace", () => {
		expect(normalizeText("  hello   world  ")).toBe("hello world");
	});

	test("preserves multiline structure while trimming edges", () => {
		expect(normalizeMultilineText("\r\n| a | b |\r|---|---|\n")).toBe(
			"| a | b |\n|---|---|",
		);
	});

	test("detects http(s) urls", () => {
		expect(hasUrl("see https://example.com/paper")).toBe(true);
		expect(hasUrl("see http://localhost:3000")).toBe(true);
		expect(hasUrl("no link here")).toBe(false);
	});
});

describe("slugify / stableHash / makeProblemId", () => {
	test("slugifies and truncates", () => {
		expect(slugify("Computer Science!")).toBe("computer-science");
		expect(slugify("  --Hello--  ")).toBe("hello");
		expect(slugify("a".repeat(50)).length).toBe(40);
	});

	test("stableHash is deterministic and 8 hex chars", () => {
		expect(stableHash("same")).toBe(stableHash("same"));
		expect(stableHash("same")).not.toBe(stableHash("different"));
		expect(stableHash("x")).toMatch(/^[0-9a-f]{8}$/);
	});

	test("makeProblemId is stable across equivalent whitespace", () => {
		const a = makeProblemId("biology", "Origin", "  How did   life begin? ");
		const b = makeProblemId("biology", "Origin", "How did life begin?");
		expect(a).toBe(b);
		expect(a.startsWith("biology-origin-")).toBe(true);
	});
});

describe("isAllowedPath", () => {
	test("allows approved data paths", () => {
		expect(isAllowedPath("/data/manifest.json")).toBe(true);
		expect(isAllowedPath("/data/problems.json")).toBe(true);
		expect(isAllowedPath("/data/enrichments.json")).toBe(true);
		expect(isAllowedPath("/data/news.json")).toBe(true);
		expect(isAllowedPath("/data/cases.json")).toBe(true);
		expect(isAllowedPath("/data/news-history/index.json")).toBe(true);
		expect(isAllowedPath("/data/news-history/2026-04-16.json")).toBe(true);
		expect(isAllowedPath("/data/case-history/index.json")).toBe(true);
		expect(isAllowedPath("/data/case-history/2026-04-16.json")).toBe(true);
	});

	test("rejects unapproved paths", () => {
		expect(isAllowedPath("/data/secret.json")).toBe(false);
		expect(isAllowedPath("/data/problems.json.bak")).toBe(false);
		expect(isAllowedPath("/mcp")).toBe(false);
		expect(isAllowedPath("/data/news-history/not-a-date.json")).toBe(false);
	});
});

describe("filterProblems", () => {
	test("filters by exact category (case-insensitive)", async () => {
		const filtered = await filterProblems(sampleProblems, emptyState(), {
			category: "Computer Science",
		});
		expect(filtered.map((p) => p.id)).toEqual(["computer-science-1"]);
	});

	test("filters by query across id, section, text, and enrichment", async () => {
		const byText = await filterProblems(sampleProblems, emptyState(), {
			query: "dark matter",
		});
		expect(byText.map((p) => p.id)).toEqual(["astronomy-1"]);

		const byEnrichment = await filterProblems(sampleProblems, emptyState(), {
			query: "missing mass",
		});
		expect(byEnrichment.map((p) => p.id)).toEqual(["astronomy-1"]);

		const byId = await filterProblems(sampleProblems, emptyState(), {
			query: "biology-1",
		});
		expect(byId.map((p) => p.id)).toEqual(["biology-1"]);
	});

	test("status available excludes active claims and submissions", async () => {
		const state = emptyState({
			claimsByProblemId: {
				"astronomy-1": {
					claimId: "claim_1",
					problemId: "astronomy-1",
					agentId: "agent-a",
					notes: null,
					pickedUpAt: "2026-01-01T00:00:00.000Z",
					leaseExpiresAt: "2099-01-01T00:00:00.000Z",
					status: "active",
				},
			},
			solutionsByProblemId: {
				"biology-1": [
					{
						submissionId: "sub_1",
						claimId: "claim_old",
						problemId: "biology-1",
						agentId: "agent-b",
						submittedAt: "2026-01-02T00:00:00.000Z",
						title: null,
						summary: "done",
						approach: null,
						evidence: null,
						artifactUrl: null,
						confidence: null,
					},
				],
			},
		});

		const available = await filterProblems(sampleProblems, state, {
			status: "available",
		});
		expect(available.map((p) => p.id).sort()).toEqual([
			"chemistry-1",
			"computer-science-1",
		]);

		const claimed = await filterProblems(sampleProblems, state, {
			status: "claimed",
		});
		expect(claimed.map((p) => p.id)).toEqual(["astronomy-1"]);

		const submitted = await filterProblems(sampleProblems, state, {
			status: "submitted",
		});
		expect(submitted.map((p) => p.id)).toEqual(["biology-1"]);

		const all = await filterProblems(sampleProblems, state, {
			status: "all",
		});
		expect(all).toHaveLength(4);
	});

	test("released claims do not block available status", async () => {
		const state = emptyState({
			claimsByProblemId: {
				"chemistry-1": {
					claimId: "claim_r",
					problemId: "chemistry-1",
					agentId: "agent-c",
					notes: null,
					pickedUpAt: "2026-01-01T00:00:00.000Z",
					leaseExpiresAt: "2026-01-02T00:00:00.000Z",
					status: "released",
					releasedAt: "2026-01-01T12:00:00.000Z",
				},
			},
		});

		const available = await filterProblems(sampleProblems, state, {
			status: "available",
			category: "chemistry",
		});
		expect(available.map((p) => p.id)).toEqual(["chemistry-1"]);
	});

	test("combines category and query filters", async () => {
		const filtered = await filterProblems(sampleProblems, emptyState(), {
			category: "astronomy",
			query: "life",
		});
		expect(filtered).toEqual([]);
	});
});

describe("createCatalogSummary", () => {
	test("counts totals and per-category inventory", () => {
		const state = emptyState({
			claimsByProblemId: {
				"astronomy-1": {
					claimId: "claim_1",
					problemId: "astronomy-1",
					agentId: "agent-a",
					notes: null,
					pickedUpAt: "2026-01-01T00:00:00.000Z",
					leaseExpiresAt: "2099-01-01T00:00:00.000Z",
					status: "active",
				},
			},
			solutionsByProblemId: {
				"biology-1": [
					{
						submissionId: "sub_1",
						claimId: "claim_old",
						problemId: "biology-1",
						agentId: "agent-b",
						submittedAt: "2026-01-02T00:00:00.000Z",
						title: null,
						summary: "done",
						approach: null,
						evidence: null,
						artifactUrl: null,
						confidence: null,
					},
				],
			},
			researchEntriesByProblemId: {
				"chemistry-1": [
					{
						entryId: "research_1",
						problemId: "chemistry-1",
						agentId: "agent-c",
						kind: "note",
						createdAt: "2026-01-03T00:00:00.000Z",
						title: "Note",
						content: "content",
						artifactUrl: null,
					},
				],
			},
		});

		const summary = createCatalogSummary(sampleProblems, state);
		expect(summary.totalProblems).toBe(4);
		expect(summary.availableProblems).toBe(2);
		expect(summary.claimedProblems).toBe(1);
		expect(summary.submittedProblems).toBe(1);
		expect(summary.researchProblems).toBe(1);
		expect(summary.categories).toEqual({
			astronomy: 1,
			biology: 1,
			chemistry: 1,
			"computer science": 1,
		});
	});
});

describe("queue helpers", () => {
	test("cloneQueueState deep-copies nested records", () => {
		const original = emptyState({
			claimsByProblemId: {
				"p-1": {
					claimId: "c1",
					problemId: "p-1",
					agentId: "a",
					notes: null,
					pickedUpAt: "2026-01-01T00:00:00.000Z",
					leaseExpiresAt: "2099-01-01T00:00:00.000Z",
					status: "active",
				},
			},
			researchEntriesByProblemId: {
				"p-1": [
					{
						entryId: "r1",
						problemId: "p-1",
						agentId: "a",
						kind: "note",
						createdAt: "2026-01-01T00:00:00.000Z",
						title: "t",
						content: "c",
						artifactUrl: null,
					},
				],
			},
		});

		const cloned = cloneQueueState(original);
		const clonedClaim = cloned.claimsByProblemId["p-1"];
		const clonedEntry = cloned.researchEntriesByProblemId["p-1"]?.[0];
		expect(clonedClaim).toBeDefined();
		expect(clonedEntry).toBeDefined();
		if (!clonedClaim || !clonedEntry) {
			throw new Error("expected cloned claim and research entry");
		}
		clonedClaim.agentId = "mutated";
		clonedEntry.title = "mutated";

		expect(original.claimsByProblemId["p-1"]?.agentId).toBe("a");
		expect(original.researchEntriesByProblemId["p-1"]?.[0]?.title).toBe("t");
	});

	test("pruneExpiredClaims marks only expired active leases", () => {
		const state = emptyState({
			claimsByProblemId: {
				expired: {
					claimId: "c-exp",
					problemId: "expired",
					agentId: "a",
					notes: null,
					pickedUpAt: "2020-01-01T00:00:00.000Z",
					leaseExpiresAt: "2020-01-02T00:00:00.000Z",
					status: "active",
				},
				fresh: {
					claimId: "c-fresh",
					problemId: "fresh",
					agentId: "b",
					notes: null,
					pickedUpAt: "2026-01-01T00:00:00.000Z",
					leaseExpiresAt: "2099-01-01T00:00:00.000Z",
					status: "active",
				},
				released: {
					claimId: "c-rel",
					problemId: "released",
					agentId: "c",
					notes: null,
					pickedUpAt: "2020-01-01T00:00:00.000Z",
					leaseExpiresAt: "2020-01-02T00:00:00.000Z",
					status: "released",
					releasedAt: "2020-01-01T12:00:00.000Z",
				},
			},
		});

		expect(pruneExpiredClaims(state)).toBe(true);
		expect(state.claimsByProblemId.expired?.status).toBe("expired");
		expect(state.claimsByProblemId.expired?.releasedAt).toBeTruthy();
		expect(state.claimsByProblemId.fresh?.status).toBe("active");
		expect(state.claimsByProblemId.released?.status).toBe("released");
		expect(pruneExpiredClaims(state)).toBe(false);
	});

	test("createQueueSnapshot ignores token-usage research entries", () => {
		const entries: ResearchEntry[] = [
			{
				entryId: "r1",
				problemId: "p-1",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-01T00:00:00.000Z",
				title: "Real note",
				content: "substance",
				artifactUrl: null,
			},
			{
				entryId: "r2",
				problemId: "p-1",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-02T00:00:00.000Z",
				title: "Token usage for run",
				content: "inputTokens: 10",
				artifactUrl: null,
			},
		];

		const snapshot = createQueueSnapshot(
			emptyState({
				claimsByProblemId: {
					"p-1": {
						claimId: "c1",
						problemId: "p-1",
						agentId: "a",
						notes: null,
						pickedUpAt: "2026-01-01T00:00:00.000Z",
						leaseExpiresAt: "2099-01-01T00:00:00.000Z",
						status: "active",
					},
				},
				researchEntriesByProblemId: { "p-1": entries },
			}),
		);

		expect(snapshot.activeClaims).toHaveLength(1);
		expect(snapshot.researchCountsByProblemId["p-1"]).toBe(1);
		expect(snapshot.lastResearchAtByProblemId["p-1"]).toBe(
			"2026-01-01T00:00:00.000Z",
		);
		expect(snapshot.recentResearchEntries).toHaveLength(1);
		expect(snapshot.recentResearchEntries[0]?.title).toBe("Real note");
	});

	test("createClaimRecord / submission / research entry factories", () => {
		const claim = createClaimRecord("math-1", "agent-1", 30, "note");
		expect(claim.claimId.startsWith("claim_")).toBe(true);
		expect(claim.problemId).toBe("math-1");
		expect(claim.agentId).toBe("agent-1");
		expect(claim.status).toBe("active");
		expect(claim.notes).toBe("note");
		expect(new Date(claim.leaseExpiresAt).getTime()).toBeGreaterThan(
			Date.now(),
		);

		const submission = createSubmissionRecord(claim, {
			title: "Attempt",
			summary: "summary",
			approach: "approach",
			evidence: "evidence",
			artifactUrl: "https://example.com",
			confidence: 0.4,
		});
		expect(submission.submissionId.startsWith("submission_")).toBe(true);
		expect(submission.claimId).toBe(claim.claimId);
		expect(submission.confidence).toBe(0.4);

		const entry = createResearchEntryRecord({
			problemId: "math-1",
			agentId: "agent-1",
			kind: "hypothesis",
			title: "Guess",
			content: "Maybe",
			artifactUrl: null,
		});
		expect(entry.entryId.startsWith("research_")).toBe(true);
		expect(entry.kind).toBe("hypothesis");
	});
});

describe("usage research filtering", () => {
	test("detects token usage titles case-insensitively", () => {
		expect(
			isUsageResearchEntry({
				entryId: "1",
				problemId: "p",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-01T00:00:00.000Z",
				title: "TOKEN USAGE summary",
				content: "x",
				artifactUrl: null,
			}),
		).toBe(true);
		expect(
			isUsageResearchEntry({
				entryId: "2",
				problemId: "p",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-01T00:00:00.000Z",
				title: "Research note",
				content: "x",
				artifactUrl: null,
			}),
		).toBe(false);
		expect(
			isUsageResearchEntry({
				entryId: "3",
				problemId: "p",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-01T00:00:00.000Z",
				title: null,
				content: "x",
				artifactUrl: null,
			}),
		).toBe(false);
	});

	test("substantiveResearchEntries drops usage rows", () => {
		const entries: ResearchEntry[] = [
			{
				entryId: "1",
				problemId: "p",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-01T00:00:00.000Z",
				title: "Real",
				content: "x",
				artifactUrl: null,
			},
			{
				entryId: "2",
				problemId: "p",
				agentId: "a",
				kind: "note",
				createdAt: "2026-01-02T00:00:00.000Z",
				title: "token usage",
				content: "x",
				artifactUrl: null,
			},
		];
		expect(substantiveResearchEntries(entries)).toHaveLength(1);
		expect(substantiveResearchEntries(undefined)).toEqual([]);
	});
});

describe("ProblemClaim shape used by filters", () => {
	test("active claim typed fixture is accepted by prune", () => {
		const claim: ProblemClaim = {
			claimId: "claim_x",
			problemId: "p",
			agentId: "a",
			notes: null,
			pickedUpAt: "2020-01-01T00:00:00.000Z",
			leaseExpiresAt: "2020-01-02T00:00:00.000Z",
			status: "active",
		};
		const state = emptyState({ claimsByProblemId: { p: claim } });
		pruneExpiredClaims(state);
		expect(state.claimsByProblemId.p?.status).toBe("expired");
	});
});
