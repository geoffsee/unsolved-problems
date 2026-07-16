import { fileURLToPath } from "node:url";
import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
	type AuthBindings,
	type AuthenticatedPrincipal,
	AuthStoreDurableObject,
	createApiToken,
	createOAuthState,
	createSession,
	exchangeGithubCode,
	getPagesOrigin as getAuthPagesOrigin,
	getGithubClientId,
	isContributionAuthRequired,
	isDevAuthAllowed,
	isLocalAuthEnabled,
	isSafeReturnTo,
	listApiTokens,
	loginLocalAccount,
	publicTokenView,
	registerLocalAccount,
	requireContributionAuth,
	resolvePrincipal,
	revokeApiToken,
	revokeSession,
	unauthorizedContributionMessage,
	verifyOAuthState,
} from "./auth";
import { JsonFileStateStore, type StateStore } from "./persistence";

export { AuthStoreDurableObject };

type Bindings = AuthBindings & {
	PAGES_ORIGIN?: string;
	PROBLEM_QUEUE?: DurableObjectNamespace;
};

type ProblemSection = {
	heading: string;
	problems: string[];
};

type ProblemsPayload = {
	categories?: Record<string, ProblemSection[]>;
};

type Enrichment = {
	summary?: string;
	significance?: string;
	field?: string;
	year?: number;
	yearProposed?: number;
};

type EnrichmentsPayload = {
	problems?: Record<string, Enrichment>;
};

export type ProblemRecord = {
	id: string;
	category: string;
	section: string;
	text: string;
	enrichment: Enrichment | null;
};

export type ClaimStatus = "active" | "released" | "submitted" | "expired";

export type ProblemClaim = {
	claimId: string;
	problemId: string;
	agentId: string;
	notes: string | null;
	pickedUpAt: string;
	leaseExpiresAt: string;
	status: ClaimStatus;
	releasedAt?: string;
};

export type SubmittedSolution = {
	submissionId: string;
	claimId: string;
	problemId: string;
	agentId: string;
	submittedAt: string;
	title: string | null;
	summary: string;
	approach: string | null;
	evidence: string | null;
	artifactUrl: string | null;
	confidence: number | null;
};

export type ResearchEntryKind =
	| "note"
	| "reference"
	| "hypothesis"
	| "failed_attempt"
	| "handoff"
	| "candidate_approach";

export type ResearchEntry = {
	entryId: string;
	problemId: string;
	agentId: string;
	kind: ResearchEntryKind;
	createdAt: string;
	title: string | null;
	content: string;
	artifactUrl: string | null;
};

export function isUsageResearchEntry(entry: ResearchEntry) {
	return entry.title?.toLowerCase().includes("token usage") ?? false;
}

export function substantiveResearchEntries(
	entries: ResearchEntry[] | undefined,
) {
	return (entries ?? []).filter((entry) => !isUsageResearchEntry(entry));
}

export type QueueState = {
	claimsByProblemId: Record<string, ProblemClaim>;
	solutionsByProblemId: Record<string, SubmittedSolution[]>;
	researchEntriesByProblemId: Record<string, ResearchEntry[]>;
};

export type QueueSnapshot = {
	activeClaims: ProblemClaim[];
	submissions: SubmittedSolution[];
	recentResearchEntries: ResearchEntry[];
	researchCountsByProblemId: Record<string, number>;
	lastResearchAtByProblemId: Record<string, string>;
};

const app = new Hono<{ Bindings: Bindings }>();

const APP_VERSION = "0.1.0";
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PICK_LIMIT = 25;
const MAX_PICK_LIMIT = 100;
const DEFAULT_LEASE_MINUTES = 120;
const MAX_LEASE_MINUTES = 7 * 24 * 60;
const DEFAULT_PAGES_ORIGIN = "https://geoffsee.github.io/open-questions";
const DEFAULT_SEARXNG_ORIGIN = "https://searxng.seemueller.io";

type SearxngResult = {
	title?: string;
	url?: string;
	content?: string;
	engine?: string;
	engines?: string[];
	score?: number;
};

type SearxngResponse = {
	results?: SearxngResult[];
	answers?: string[];
	suggestions?: string[];
	unresponsive_engines?: Array<[string, string]>;
};

function getLocalStatePath() {
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
			process.env.OPEN_QUESTIONS_STATE_PATH ||
			fileURLToPath(new URL("../data/agent-queue.json", metaUrl))
		);
	} catch {
		return null;
	}
}

const ALLOWED_PATTERNS = [
	/^\/data\/(?:problems|enrichments|news|cases)\.json$/,
	/^\/data\/news-history\/(?:index|\d{4}-\d{2}-\d{2})\.json$/,
	/^\/data\/case-history\/(?:index|\d{4}-\d{2}-\d{2})\.json$/,
];

const FORWARDED_HEADERS = [
	"cache-control",
	"content-type",
	"etag",
	"expires",
	"last-modified",
];

const EMPTY_QUEUE_STATE: QueueState = {
	claimsByProblemId: {},
	solutionsByProblemId: {},
	researchEntriesByProblemId: {},
};
let queueStore: StateStore<QueueState> | undefined;

let cachedProblems:
	| {
			expiresAt: number;
			problems: ProblemRecord[];
	  }
	| undefined;

function getPagesOrigin(env?: Bindings) {
	return (
		env?.PAGES_ORIGIN ||
		process.env.PAGES_ORIGIN ||
		DEFAULT_PAGES_ORIGIN
	).replace(/\/+$/, "");
}

function getSearxngOrigin() {
	return (process.env.SEARXNG_ORIGIN || DEFAULT_SEARXNG_ORIGIN).replace(
		/\/+$/,
		"",
	);
}

export function isAllowedPath(pathname: string) {
	return ALLOWED_PATTERNS.some((pattern) => pattern.test(pathname));
}

function buildUpstreamUrl(pathname: string, env?: Bindings) {
	return new URL(`${getPagesOrigin(env)}${pathname}`);
}

function jsonError(message: string, status: number) {
	return Response.json({ error: message }, { status });
}

export function normalizeText(value: string) {
	return value.trim().replace(/\s+/g, " ");
}

/** Trim edges but keep markdown structure (tables, lists, code fences). */
export function normalizeMultilineText(value: string) {
	return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function hasUrl(value: string) {
	return /https?:\/\/\S+/i.test(value);
}

const artifactUrlSchema = z
	.string()
	.min(1)
	.refine(
		(value) => {
			if (value.startsWith("data:")) return true;
			try {
				const parsed = new URL(value);
				return parsed.protocol === "http:" || parsed.protocol === "https:";
			} catch {
				return false;
			}
		},
		{
			message: "artifactUrl must be an http(s) URL or a data: URI",
		},
	);

export function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
}

export function stableHash(value: string) {
	let hash = 2166136261;

	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeProblemId(category: string, section: string, text: string) {
	const material = `${category}::${section}::${normalizeText(text)}`;
	return `${slugify(category)}-${slugify(section)}-${stableHash(material)}`;
}

function nowIso() {
	return new Date().toISOString();
}

function textContent(text: string) {
	return [{ type: "text" as const, text }];
}

export function cloneQueueState(state: QueueState): QueueState {
	const researchEntriesByProblemId = state.researchEntriesByProblemId ?? {};

	return {
		claimsByProblemId: Object.fromEntries(
			Object.entries(state.claimsByProblemId).map(([key, value]) => [
				key,
				{ ...value },
			]),
		),
		solutionsByProblemId: Object.fromEntries(
			Object.entries(state.solutionsByProblemId).map(([key, values]) => [
				key,
				values.map((value) => ({ ...value })),
			]),
		),
		researchEntriesByProblemId: Object.fromEntries(
			Object.entries(researchEntriesByProblemId).map(([key, values]) => [
				key,
				values.map((value) => ({ ...value })),
			]),
		),
	};
}

export function emptyQueueState(): QueueState {
	return cloneQueueState(EMPTY_QUEUE_STATE);
}

function getQueueStore(): StateStore<QueueState> {
	if (!queueStore) {
		queueStore = new JsonFileStateStore(
			getLocalStatePath(),
			emptyQueueState(),
			cloneQueueState,
		);
	}
	return queueStore;
}

function readLocalQueueState() {
	return getQueueStore().read();
}

function writeLocalQueueState(state: QueueState) {
	getQueueStore().write(state);
}

/** Override local persistence, for example with a SQLite-backed Bun store. */
export function configureQueueStore(store: StateStore<QueueState>) {
	queueStore = store;
}

export function pruneExpiredClaims(state: QueueState) {
	const now = Date.now();
	let changed = false;

	for (const [problemId, claim] of Object.entries(state.claimsByProblemId)) {
		if (
			claim.status === "active" &&
			new Date(claim.leaseExpiresAt).getTime() <= now
		) {
			state.claimsByProblemId[problemId] = {
				...claim,
				status: "expired",
				releasedAt: nowIso(),
			};
			changed = true;
		}
	}

	return changed;
}

export function createQueueSnapshot(state: QueueState): QueueSnapshot {
	const researchCountsByProblemId = Object.fromEntries(
		Object.entries(state.researchEntriesByProblemId).map(
			([problemId, entries]) => [
				problemId,
				substantiveResearchEntries(entries).length,
			],
		),
	);
	const lastResearchAtByProblemId = Object.fromEntries(
		Object.entries(state.researchEntriesByProblemId)
			.map(([problemId, entries]) => {
				const substantive = substantiveResearchEntries(entries);
				return [problemId, substantive.at(-1)?.createdAt ?? null] as const;
			})
			.filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
	);

	return {
		activeClaims: Object.values(state.claimsByProblemId).filter(
			(claim) => claim.status === "active",
		),
		submissions: Object.values(state.solutionsByProblemId).flat(),
		recentResearchEntries: Object.values(state.researchEntriesByProblemId)
			.flat()
			.filter((entry) => !isUsageResearchEntry(entry))
			.sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			)
			.slice(0, 50),
		researchCountsByProblemId,
		lastResearchAtByProblemId,
	};
}

export function createClaimRecord(
	problemId: string,
	agentId: string,
	leaseMinutes: number,
	notes: string | null,
): ProblemClaim {
	return {
		claimId: `claim_${crypto.randomUUID()}`,
		problemId,
		agentId,
		notes,
		pickedUpAt: nowIso(),
		leaseExpiresAt: new Date(
			Date.now() + leaseMinutes * 60 * 1000,
		).toISOString(),
		status: "active",
	};
}

export function createSubmissionRecord(
	claim: ProblemClaim,
	input: {
		title: string | null;
		summary: string;
		approach: string | null;
		evidence: string | null;
		artifactUrl: string | null;
		confidence: number | null;
	},
): SubmittedSolution {
	return {
		submissionId: `submission_${crypto.randomUUID()}`,
		claimId: claim.claimId,
		problemId: claim.problemId,
		agentId: claim.agentId,
		submittedAt: nowIso(),
		title: input.title,
		summary: input.summary,
		approach: input.approach,
		evidence: input.evidence,
		artifactUrl: input.artifactUrl,
		confidence: input.confidence,
	};
}

export function createResearchEntryRecord(input: {
	problemId: string;
	agentId: string;
	kind: ResearchEntryKind;
	title: string | null;
	content: string;
	artifactUrl: string | null;
}): ResearchEntry {
	return {
		entryId: `research_${crypto.randomUUID()}`,
		problemId: input.problemId,
		agentId: input.agentId,
		kind: input.kind,
		createdAt: nowIso(),
		title: input.title,
		content: input.content,
		artifactUrl: input.artifactUrl,
	};
}

async function fetchJson<T>(pathname: string, env?: Bindings): Promise<T> {
	const url = buildUpstreamUrl(pathname, env);
	const response = await fetch(url, {
		headers: {
			accept: "application/json",
			"user-agent": "open-questions-mcp/1.0",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Unable to load ${pathname}: upstream returned ${response.status}.`,
		);
	}

	return (await response.json()) as T;
}

async function searchSearxng(input: {
	query: string;
	categories?: string;
	language?: string;
	limit: number;
}) {
	const url = new URL(`${getSearxngOrigin()}/search`);
	url.searchParams.set("q", input.query);
	url.searchParams.set("format", "json");
	url.searchParams.set("safesearch", "1");
	if (input.categories) url.searchParams.set("categories", input.categories);
	if (input.language) url.searchParams.set("language", input.language);

	const response = await fetch(url, {
		headers: {
			accept: "application/json",
			"user-agent": "open-questions-mcp/1.0",
		},
	});

	if (!response.ok) {
		throw new Error(`SearXNG returned ${response.status}.`);
	}

	const payload = (await response.json()) as SearxngResponse;
	const results = (payload.results ?? [])
		.filter((result) => result.title && result.url)
		.slice(0, input.limit)
		.map((result) => ({
			title: normalizeText(result.title ?? ""),
			url: result.url ?? "",
			snippet: result.content ? normalizeText(result.content) : null,
			engines: result.engines ?? (result.engine ? [result.engine] : []),
			score: result.score ?? null,
		}));

	return {
		query: input.query,
		answers: payload.answers ?? [],
		suggestions: payload.suggestions ?? [],
		unresponsiveEngines: payload.unresponsive_engines ?? [],
		results,
	};
}

async function loadProblems(env?: Bindings) {
	const now = Date.now();
	if (cachedProblems && cachedProblems.expiresAt > now) {
		return cachedProblems.problems;
	}

	const [problemsPayload, enrichmentsPayload] = await Promise.all([
		fetchJson<ProblemsPayload>("/data/problems.json", env),
		fetchJson<EnrichmentsPayload>("/data/enrichments.json", env).catch(
			(): EnrichmentsPayload => ({ problems: {} }),
		),
	]);

	const problems: ProblemRecord[] = [];
	const categories = problemsPayload.categories ?? {};
	const enrichments = enrichmentsPayload.problems ?? {};

	for (const [category, sections] of Object.entries(categories)) {
		for (const section of sections) {
			for (const text of section.problems ?? []) {
				problems.push({
					id: makeProblemId(category, section.heading, text),
					category,
					section: section.heading,
					text,
					enrichment: enrichments[text.slice(0, 120)] ?? null,
				});
			}
		}
	}

	problems.sort((a, b) => {
		const categoryOrder = a.category.localeCompare(b.category);
		if (categoryOrder !== 0) return categoryOrder;

		const sectionOrder = a.section.localeCompare(b.section);
		if (sectionOrder !== 0) return sectionOrder;

		return a.text.localeCompare(b.text);
	});

	cachedProblems = {
		expiresAt: now + CACHE_TTL_MS,
		problems,
	};

	return problems;
}

async function getProblem(problemId: string, env?: Bindings) {
	const problems = await loadProblems(env);
	return problems.find((problem) => problem.id === problemId) ?? null;
}

async function callQueueObject(
	env: Bindings,
	path: string,
	init?: RequestInit,
) {
	const id = env.PROBLEM_QUEUE?.idFromName("global");
	const stub = id && env.PROBLEM_QUEUE?.get(id);

	if (!stub) {
		throw new Error("PROBLEM_QUEUE Durable Object binding is not configured.");
	}

	const response = await stub.fetch(
		`https://problem-queue.internal${path}`,
		init,
	);
	if (!response.ok) {
		const message = await response.text();
		throw new Error(message || `Queue request failed with ${response.status}.`);
	}

	return response.json();
}

async function readQueueState(env?: Bindings): Promise<QueueState> {
	if (env?.PROBLEM_QUEUE) {
		return cloneQueueState(
			(await callQueueObject(env, "/state")) as QueueState,
		);
	}

	return readLocalQueueState();
}

async function getQueueSnapshot(env?: Bindings): Promise<QueueSnapshot> {
	if (env?.PROBLEM_QUEUE) {
		return createQueueSnapshot(await readQueueState(env));
	}

	const state = readLocalQueueState();
	if (pruneExpiredClaims(state)) {
		writeLocalQueueState(state);
	}

	return createQueueSnapshot(state);
}

async function createClaim(
	env: Bindings | undefined,
	problemId: string,
	agentId: string,
	leaseMinutes: number,
	notes: string | null,
) {
	if (env?.PROBLEM_QUEUE) {
		return (await callQueueObject(env, "/claims", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ problemId, agentId, leaseMinutes, notes }),
		})) as { claim: ProblemClaim };
	}

	const state = readLocalQueueState();
	if (pruneExpiredClaims(state)) {
		writeLocalQueueState(state);
	}

	const claim = createClaimRecord(problemId, agentId, leaseMinutes, notes);
	state.claimsByProblemId[problemId] = claim;
	writeLocalQueueState(state);

	return { claim };
}

async function releaseClaim(
	env: Bindings | undefined,
	claimId: string,
	agentId: string,
) {
	if (env?.PROBLEM_QUEUE) {
		return (await callQueueObject(
			env,
			`/claims/${encodeURIComponent(claimId)}/release`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ agentId }),
			},
		)) as { claim: ProblemClaim };
	}

	const state = readLocalQueueState();
	if (pruneExpiredClaims(state)) {
		writeLocalQueueState(state);
	}

	const claim = Object.values(state.claimsByProblemId).find(
		(entry) => entry.claimId === claimId,
	);
	if (!claim) throw new Error(`Unknown claimId: ${claimId}`);
	if (claim.agentId !== agentId)
		throw new Error(
			`Claim ${claimId} belongs to ${claim.agentId}, not ${agentId}.`,
		);
	if (claim.status !== "active")
		throw new Error(`Claim ${claimId} is already ${claim.status}.`);

	const releasedClaim = {
		...claim,
		status: "released" as const,
		releasedAt: nowIso(),
	};
	state.claimsByProblemId[claim.problemId] = releasedClaim;
	writeLocalQueueState(state);

	return { claim: releasedClaim };
}

async function submitClaimSolution(
	env: Bindings | undefined,
	input: {
		claimId: string;
		agentId: string;
		title: string | null;
		summary: string;
		approach: string | null;
		evidence: string | null;
		artifactUrl: string | null;
		confidence: number | null;
	},
) {
	if (env?.PROBLEM_QUEUE) {
		return (await callQueueObject(
			env,
			`/claims/${encodeURIComponent(input.claimId)}/submit`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(input),
			},
		)) as { claim: ProblemClaim; submission: SubmittedSolution };
	}

	const state = readLocalQueueState();
	if (pruneExpiredClaims(state)) {
		writeLocalQueueState(state);
	}

	const claim = Object.values(state.claimsByProblemId).find(
		(entry) => entry.claimId === input.claimId,
	);
	if (!claim) throw new Error(`Unknown claimId: ${input.claimId}`);
	if (claim.agentId !== input.agentId)
		throw new Error(
			`Claim ${input.claimId} belongs to ${claim.agentId}, not ${input.agentId}.`,
		);
	if (claim.status !== "active")
		throw new Error(
			`Claim ${input.claimId} is ${claim.status} and cannot accept a submission.`,
		);

	const submission = createSubmissionRecord(claim, input);
	state.solutionsByProblemId[claim.problemId] = [
		...(state.solutionsByProblemId[claim.problemId] ?? []),
		submission,
	];
	state.claimsByProblemId[claim.problemId] = {
		...claim,
		status: "submitted",
		releasedAt: submission.submittedAt,
	};
	writeLocalQueueState(state);

	return {
		claim: state.claimsByProblemId[claim.problemId],
		submission,
	};
}

async function listClaims(env?: Bindings) {
	const state = await readQueueState(env);
	if (!env?.PROBLEM_QUEUE && pruneExpiredClaims(state)) {
		writeLocalQueueState(state);
	}
	return Object.values(state.claimsByProblemId);
}

async function appendResearchEntry(
	env: Bindings | undefined,
	input: {
		problemId: string;
		agentId: string;
		kind: ResearchEntryKind;
		title: string | null;
		content: string;
		artifactUrl: string | null;
	},
) {
	if (env?.PROBLEM_QUEUE) {
		return (await callQueueObject(env, "/research", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		})) as { entry: ResearchEntry };
	}

	const state = readLocalQueueState();
	const entry = createResearchEntryRecord(input);
	state.researchEntriesByProblemId[input.problemId] = [
		...(state.researchEntriesByProblemId[input.problemId] ?? []),
		entry,
	];
	writeLocalQueueState(state);

	return { entry };
}

async function summarizeProblem(problem: ProblemRecord, state: QueueState) {
	const claim = state.claimsByProblemId[problem.id];
	const status =
		claim?.status === "active"
			? "claimed"
			: (state.solutionsByProblemId[problem.id]?.length ?? 0) > 0
				? "submitted"
				: "available";

	return {
		id: problem.id,
		category: problem.category,
		section: problem.section,
		text: problem.text,
		status,
		enrichment: problem.enrichment,
		researchEntryCount: substantiveResearchEntries(
			state.researchEntriesByProblemId[problem.id],
		).length,
		lastResearchAt:
			substantiveResearchEntries(
				state.researchEntriesByProblemId[problem.id],
			).at(-1)?.createdAt ?? null,
	};
}

export async function filterProblems(
	problems: ProblemRecord[],
	state: QueueState,
	filters: {
		category?: string;
		query?: string;
		status?: "available" | "claimed" | "submitted" | "all";
	},
) {
	const normalizedCategory = filters.category?.trim().toLowerCase();
	const normalizedQuery = filters.query
		? normalizeText(filters.query).toLowerCase()
		: null;

	return problems.filter((problem) => {
		const claim = state.claimsByProblemId[problem.id];
		const queueStatus =
			claim?.status === "active"
				? "claimed"
				: (state.solutionsByProblemId[problem.id]?.length ?? 0) > 0
					? "submitted"
					: "available";

		if (
			normalizedCategory &&
			problem.category.toLowerCase() !== normalizedCategory
		)
			return false;
		if (
			filters.status &&
			filters.status !== "all" &&
			queueStatus !== filters.status
		)
			return false;

		if (!normalizedQuery) return true;

		const haystack = [
			problem.id,
			problem.category,
			problem.section,
			problem.text,
			problem.enrichment?.summary,
			problem.enrichment?.significance,
		]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();

		return haystack.includes(normalizedQuery);
	});
}

export function createCatalogSummary(
	problems: ProblemRecord[],
	state: QueueState,
) {
	const categories = problems.reduce<Record<string, number>>((acc, problem) => {
		acc[problem.category] = (acc[problem.category] ?? 0) + 1;
		return acc;
	}, {});

	const availableProblems = problems.filter(
		(problem) =>
			!state.claimsByProblemId[problem.id] &&
			!(state.solutionsByProblemId[problem.id]?.length ?? 0),
	).length;
	const claimedProblems = Object.values(state.claimsByProblemId).filter(
		(claim) => claim.status === "active",
	).length;
	const submittedProblems = Object.values(state.solutionsByProblemId).filter(
		(items) => items.length > 0,
	).length;
	const researchProblems = Object.values(
		state.researchEntriesByProblemId,
	).filter((items) => items.length > 0).length;

	return {
		totalProblems: problems.length,
		availableProblems,
		claimedProblems,
		submittedProblems,
		researchProblems,
		categories,
	};
}

function contributionAuthError() {
	return {
		content: textContent(unauthorizedContributionMessage()),
		isError: true as const,
	};
}

function createMcpServer(
	env?: Bindings,
	principal: AuthenticatedPrincipal | null = null,
) {
	const server = new McpServer({
		name: "open-questions",
		version: APP_VERSION,
	});

	const requireContributor = () => {
		const allowed = requireContributionAuth(principal, env);
		if (isContributionAuthRequired(env) && !allowed) {
			return null;
		}
		return allowed ?? principal;
	};

	server.registerResource(
		"catalog",
		"open-questions://catalog",
		{
			title: "Problem catalog",
			description: "Summary metadata for the open-questions queue.",
			mimeType: "application/json",
		},
		async (uri) => {
			const [problems, state] = await Promise.all([
				loadProblems(env),
				readQueueState(env),
			]);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(
							createCatalogSummary(problems, state),
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerResource(
		"queue",
		"open-questions://queue",
		{
			title: "Queue state",
			description:
				"Active claims and submitted solutions currently tracked by the MCP server.",
			mimeType: "application/json",
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.toString(),
					mimeType: "application/json",
					text: JSON.stringify(await getQueueSnapshot(env), null, 2),
				},
			],
		}),
	);

	server.registerResource(
		"problem",
		new ResourceTemplate("open-questions://problem/{problemId}", {
			list: undefined,
		}),
		{
			title: "Problem detail",
			description: "Detailed metadata for a single problem.",
			mimeType: "application/json",
		},
		async (uri, variables) => {
			const problemId = String(variables.problemId ?? "");
			const [problem, state] = await Promise.all([
				getProblem(problemId, env),
				readQueueState(env),
			]);

			if (!problem) {
				throw new Error(`Unknown problemId: ${problemId}`);
			}

			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "application/json",
						text: JSON.stringify(
							{
								...(await summarizeProblem(problem, state)),
								activeClaim:
									state.claimsByProblemId[problemId]?.status === "active"
										? state.claimsByProblemId[problemId]
										: null,
								submissions: state.solutionsByProblemId[problemId] ?? [],
								researchEntries:
									state.researchEntriesByProblemId[problemId] ?? [],
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	server.registerPrompt(
		"work_problem",
		{
			title: "Work an unsolved problem",
			description:
				"Generate a research-oriented work plan for a claimed problem before submitting a solution.",
			argsSchema: {
				problemId: z.string(),
				agentId: z.string(),
			},
		},
		async ({ problemId, agentId }) => {
			const problem = await getProblem(problemId, env);
			if (!problem) {
				throw new Error(`Unknown problemId: ${problemId}`);
			}

			return {
				description: `Working prompt for ${problem.id}`,
				messages: [
					{
						role: "user",
						content: {
							type: "text",
							text: [
								`You are agent ${agentId}.`,
								`Problem ID: ${problem.id}`,
								`Category: ${problem.category}`,
								`Section: ${problem.section}`,
								`Problem: ${problem.text}`,
								problem.enrichment?.summary
									? `Summary: ${problem.enrichment.summary}`
									: null,
								"Produce durable research, not a generic status update.",
								"Every saved entry should state a concrete claim or result, its supporting basis, the main limitation or uncertainty, and the next discriminating step.",
								"Preserve exact source URLs in artifactUrl or content whenever external sources inform the entry.",
								"Only submit a candidate solution when you can supply both a reproducible approach and evidence; otherwise save a research update.",
							]
								.filter(Boolean)
								.join("\n"),
						},
					},
				],
			};
		},
	);

	server.registerTool(
		"list_problems",
		{
			title: "List Problems",
			description:
				"List unsolved problems that agents can pick up. Pass category to scope results to one field (recommended for random selection, since unfiltered results are sorted alphabetically and astronomy appears first).",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
			inputSchema: z.object({
				category: z
					.string()
					.optional()
					.describe(
						"Exact category name filter, such as astronomy, biology, or computer science.",
					),
				query: z.string().optional(),
				status: z
					.enum(["available", "claimed", "submitted", "all"])
					.optional()
					.default("available"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(MAX_PICK_LIMIT)
					.optional()
					.default(DEFAULT_PICK_LIMIT),
			}),
		},
		async ({ category, query, status, limit }) => {
			const [problems, state] = await Promise.all([
				loadProblems(env),
				readQueueState(env),
			]);
			const filtered = await filterProblems(problems, state, {
				category,
				query,
				status,
			});
			const items = filtered.slice(0, limit);
			const summarized = await Promise.all(
				items.map((problem) => summarizeProblem(problem, state)),
			);
			const categories = filtered.reduce<Record<string, number>>(
				(acc, problem) => {
					acc[problem.category] = (acc[problem.category] ?? 0) + 1;
					return acc;
				},
				{},
			);

			return {
				content: textContent(
					summarized.length === 0
						? "No problems matched the current filters."
						: summarized
								.map(
									(problem, index) =>
										`${index + 1}. ${problem.id} [${problem.status}] ${problem.category} / ${problem.section}: ${problem.text}`,
								)
								.join("\n"),
				),
				structuredContent: {
					items: summarized,
					totalMatched: filtered.length,
					categories,
				},
			};
		},
	);

	server.registerTool(
		"pick_problem",
		{
			title: "Pick Problem",
			description: "Claim an available problem for a specific agent.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			},
			inputSchema: z.object({
				agentId: z.string().min(1),
				problemId: z.string().optional(),
				category: z.string().optional(),
				query: z.string().optional(),
				leaseMinutes: z
					.number()
					.int()
					.min(1)
					.max(MAX_LEASE_MINUTES)
					.optional()
					.default(DEFAULT_LEASE_MINUTES),
				notes: z.string().optional(),
			}),
		},
		async ({ agentId, problemId, category, query, leaseMinutes, notes }) => {
			const contributor = requireContributor();
			if (isContributionAuthRequired(env) && !contributor) {
				return contributionAuthError();
			}

			const normalizedAgentId = normalizeText(agentId);
			const [problems, state] = await Promise.all([
				loadProblems(env),
				readQueueState(env),
			]);

			let selected: ProblemRecord | undefined;
			if (problemId) {
				selected = problems.find((problem) => problem.id === problemId);
			} else {
				selected = (
					await filterProblems(problems, state, {
						category,
						query,
						status: "available",
					})
				)[0];
			}

			if (!selected) {
				return {
					content: textContent(
						problemId
							? `Unknown or unavailable problemId: ${problemId}`
							: "No available problem matched the request.",
					),
					isError: true,
				};
			}

			const existingClaim = state.claimsByProblemId[selected.id];
			if (existingClaim?.status === "active") {
				return {
					content: textContent(
						`Problem ${selected.id} is already claimed by ${existingClaim.agentId} until ${existingClaim.leaseExpiresAt}.`,
					),
					structuredContent: {
						claim: existingClaim,
						problem: await summarizeProblem(selected, state),
					},
					isError: true,
				};
			}

			if ((state.solutionsByProblemId[selected.id]?.length ?? 0) > 0) {
				return {
					content: textContent(
						`Problem ${selected.id} already has a submitted solution.`,
					),
					structuredContent: {
						problem: await summarizeProblem(selected, state),
						submissions: state.solutionsByProblemId[selected.id],
					},
					isError: true,
				};
			}

			const claimNotes = [
				notes ? normalizeText(notes) : null,
				contributor ? `github:${contributor.user.login}` : null,
			]
				.filter(Boolean)
				.join(" · ");

			const result = await createClaim(
				env,
				selected.id,
				normalizedAgentId,
				leaseMinutes,
				claimNotes || null,
			);
			const freshState = await readQueueState(env);

			return {
				content: textContent(
					[
						`Claimed ${selected.id} for ${result.claim.agentId}.`,
						`Lease expires at ${result.claim.leaseExpiresAt}.`,
						`${selected.category} / ${selected.section}: ${selected.text}`,
					].join("\n"),
				),
				structuredContent: {
					claim: result.claim,
					problem: await summarizeProblem(selected, freshState),
				},
			};
		},
	);

	server.registerTool(
		"release_problem",
		{
			title: "Release Problem",
			description: "Release an active claim without submitting a solution.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			},
			inputSchema: z.object({
				claimId: z.string(),
				agentId: z.string().min(1),
			}),
		},
		async ({ claimId, agentId }) => {
			if (isContributionAuthRequired(env) && !requireContributor()) {
				return contributionAuthError();
			}
			try {
				const result = await releaseClaim(env, claimId, normalizeText(agentId));
				return {
					content: textContent(
						`Released ${result.claim.problemId} from ${result.claim.agentId}.`,
					),
					structuredContent: {
						claim: result.claim,
					},
				};
			} catch (error) {
				return {
					content: textContent(
						error instanceof Error ? error.message : "Unable to release claim.",
					),
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		"submit_solution",
		{
			title: "Submit Solution",
			description:
				"Submit a substantive candidate solution for a previously claimed problem. Use save_progress instead when the work is only a plan, lead, or unsupported hypothesis.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: false,
			},
			inputSchema: z.object({
				claimId: z.string(),
				agentId: z.string().min(1),
				title: z
					.string()
					.min(1)
					.describe(
						"A specific, descriptive title for the candidate solution.",
					),
				summary: z
					.string()
					.min(1)
					.describe(
						"The candidate's central claim and scope, including what remains unresolved.",
					),
				approach: z
					.string()
					.min(1)
					.describe(
						"A reproducible account of the method, derivation, or experimental procedure.",
					),
				evidence: z
					.string()
					.min(1)
					.describe(
						"Concrete results and citations that support the candidate, including exact URLs where available.",
					),
				artifactUrl: artifactUrlSchema
					.optional()
					.describe(
						"A durable link to code, derivation, data, paper, or other supporting artifact.",
					),
				confidence: z
					.number()
					.min(0)
					.max(1)
					.optional()
					.describe(
						"The agent's own calibrated confidence, not a verification score.",
					),
			}),
		},
		async ({
			claimId,
			agentId,
			title,
			summary,
			approach,
			evidence,
			artifactUrl,
			confidence,
		}) => {
			if (isContributionAuthRequired(env) && !requireContributor()) {
				return contributionAuthError();
			}
			try {
				const normalizedAgentId = normalizeText(agentId);
				const result = await submitClaimSolution(env, {
					claimId,
					agentId: normalizedAgentId,
					title: title ? normalizeText(title) : null,
					summary: normalizeMultilineText(summary),
					approach: approach ? normalizeMultilineText(approach) : null,
					evidence: evidence ? normalizeMultilineText(evidence) : null,
					artifactUrl: artifactUrl ?? null,
					confidence: confidence ?? null,
				});
				const [problem, state] = await Promise.all([
					getProblem(result.claim.problemId, env),
					readQueueState(env),
				]);

				if (!problem) {
					throw new Error(
						`Problem ${result.claim.problemId} no longer exists in the catalog.`,
					);
				}

				return {
					content: textContent(
						[
							`Submitted solution ${result.submission.submissionId} for ${problem.id}.`,
							result.submission.title
								? `Title: ${result.submission.title}`
								: null,
							`Summary: ${result.submission.summary}`,
						]
							.filter(Boolean)
							.join("\n"),
					),
					structuredContent: {
						problem: await summarizeProblem(problem, state),
						claim: result.claim,
						submission: result.submission,
					},
				};
			} catch (error) {
				return {
					content: textContent(
						error instanceof Error
							? error.message
							: "Unable to submit solution.",
					),
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		"save_progress",
		{
			title: "Save Progress",
			description:
				"Save a durable research contribution: a concrete finding, cited reference, falsifiable hypothesis, failed approach with a reason, candidate method, or actionable handoff. Do not publish generic plans or status updates.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
			},
			inputSchema: z.object({
				problemId: z.string(),
				agentId: z.string().min(1),
				kind: z
					.enum([
						"note",
						"reference",
						"hypothesis",
						"failed_attempt",
						"handoff",
						"candidate_approach",
					])
					.optional()
					.default("note"),
				title: z
					.string()
					.min(1)
					.describe(
						"A specific title that says what was learned, tested, or proposed.",
					),
				content: z
					.string()
					.min(1)
					.describe(
						"State the concrete result or claim, supporting basis, principal limitation, and next discriminating step.",
					),
				artifactUrl: artifactUrlSchema
					.optional()
					.describe(
						"The most relevant exact source or artifact URL. Required for a reference unless the exact URL appears in content. Inline data: URIs are allowed for machine-readable run artifacts such as token usage.",
					),
			}),
		},
		async ({ problemId, agentId, kind, title, content, artifactUrl }) => {
			if (isContributionAuthRequired(env) && !requireContributor()) {
				return contributionAuthError();
			}

			const problem = await getProblem(problemId, env);
			if (!problem) {
				return {
					content: textContent(`Unknown problemId: ${problemId}`),
					isError: true,
				};
			}

			if (kind === "reference" && !artifactUrl && !hasUrl(content)) {
				return {
					content: textContent(
						"A reference entry must include an exact source URL in artifactUrl or content.",
					),
					isError: true,
				};
			}

			const result = await appendResearchEntry(env, {
				problemId,
				agentId: normalizeText(agentId),
				kind,
				title: title ? normalizeText(title) : null,
				content: normalizeMultilineText(content),
				artifactUrl: artifactUrl ?? null,
			});

			return {
				content: textContent(
					`Saved ${kind} entry ${result.entry.entryId} for ${problemId}.`,
				),
				structuredContent: {
					problem: await summarizeProblem(problem, await readQueueState(env)),
					entry: result.entry,
				},
			};
		},
	);

	server.registerTool(
		"search_web",
		{
			title: "Search Web",
			description:
				"Search the web through the configured SearXNG instance for sources relevant to a problem.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
			inputSchema: z.object({
				query: z.string().min(1),
				categories: z
					.string()
					.optional()
					.describe(
						"Optional SearXNG category filter, such as general, science, or news.",
					),
				language: z
					.string()
					.optional()
					.describe("Optional SearXNG language code, such as en-US or all."),
				limit: z.number().int().min(1).max(10).optional().default(5),
			}),
		},
		async ({ query, categories, language, limit }) => {
			try {
				const search = await searchSearxng({
					query: normalizeText(query),
					categories: categories ? normalizeText(categories) : undefined,
					language: language ? normalizeText(language) : undefined,
					limit,
				});

				return {
					content: textContent(
						search.results.length === 0
							? `No search results found for "${search.query}".`
							: search.results
									.map((result, index) =>
										[
											`${index + 1}. ${result.title}`,
											result.url,
											result.snippet ? `   ${result.snippet}` : null,
										]
											.filter(Boolean)
											.join("\n"),
									)
									.join("\n\n"),
					),
					structuredContent: search,
				};
			} catch (error) {
				return {
					content: textContent(
						error instanceof Error ? error.message : "Search failed.",
					),
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		"list_claims",
		{
			title: "List Claims",
			description:
				"Inspect active and historical claims, optionally filtered by agent.",
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
			inputSchema: z.object({
				agentId: z.string().optional(),
				status: z
					.enum(["active", "released", "submitted", "expired", "all"])
					.optional()
					.default("active"),
			}),
		},
		async ({ agentId, status }) => {
			const normalizedAgentId = agentId ? normalizeText(agentId) : null;
			const claims = (await listClaims(env)).filter((claim) => {
				if (normalizedAgentId && claim.agentId !== normalizedAgentId)
					return false;
				if (status !== "all" && claim.status !== status) return false;
				return true;
			});

			return {
				content: textContent(
					claims.length === 0
						? "No claims matched the current filters."
						: claims
								.map(
									(claim) =>
										`${claim.claimId} [${claim.status}] ${claim.problemId} -> ${claim.agentId} (lease ${claim.leaseExpiresAt})`,
								)
								.join("\n"),
				),
				structuredContent: {
					claims,
				},
			};
		},
	);

	return server;
}

async function handleMcpRequest(request: Request, env?: Bindings) {
	const principal = await resolvePrincipal(request, env);
	const server = createMcpServer(env, principal);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	await server.connect(transport);

	try {
		return await transport.handleRequest(request);
	} finally {
		await server.close();
	}
}

export class ProblemQueueDurableObject {
	constructor(private state: DurableObjectState) {}

	private async readState(): Promise<QueueState> {
		const stored = await this.state.storage.get<QueueState>("queue");
		const queue = cloneQueueState(
			stored ?? {
				claimsByProblemId: {},
				solutionsByProblemId: {},
				researchEntriesByProblemId: {},
			},
		);
		if (pruneExpiredClaims(queue)) {
			await this.state.storage.put("queue", queue);
		}
		return queue;
	}

	private async writeState(queue: QueueState) {
		await this.state.storage.put("queue", queue);
	}

	async fetch(request: Request) {
		const url = new URL(request.url);
		const queue = await this.readState();

		if (url.pathname === "/state" && request.method === "GET") {
			return Response.json(queue);
		}

		if (url.pathname === "/snapshot" && request.method === "GET") {
			return Response.json(createQueueSnapshot(queue));
		}

		if (url.pathname === "/research" && request.method === "POST") {
			const body = (await request.json()) as {
				problemId: string;
				agentId: string;
				kind: ResearchEntryKind;
				title: string | null;
				content: string;
				artifactUrl: string | null;
			};

			const entry = createResearchEntryRecord(body);
			queue.researchEntriesByProblemId[body.problemId] = [
				...(queue.researchEntriesByProblemId[body.problemId] ?? []),
				entry,
			];
			await this.writeState(queue);
			return Response.json({ entry });
		}

		if (url.pathname === "/claims" && request.method === "POST") {
			const body = (await request.json()) as {
				problemId: string;
				agentId: string;
				leaseMinutes: number;
				notes: string | null;
			};

			const existingClaim = queue.claimsByProblemId[body.problemId];
			if (existingClaim?.status === "active") {
				return new Response(`Problem ${body.problemId} is already claimed.`, {
					status: 409,
				});
			}

			if ((queue.solutionsByProblemId[body.problemId]?.length ?? 0) > 0) {
				return new Response(
					`Problem ${body.problemId} already has a submitted solution.`,
					{ status: 409 },
				);
			}

			const claim = createClaimRecord(
				body.problemId,
				body.agentId,
				body.leaseMinutes,
				body.notes,
			);
			queue.claimsByProblemId[body.problemId] = claim;
			await this.writeState(queue);
			return Response.json({ claim });
		}

		const releaseMatch = url.pathname.match(/^\/claims\/([^/]+)\/release$/);
		if (releaseMatch && request.method === "POST") {
			const claimId = decodeURIComponent(releaseMatch[1]);
			const body = (await request.json()) as { agentId: string };
			const claim = Object.values(queue.claimsByProblemId).find(
				(entry) => entry.claimId === claimId,
			);

			if (!claim)
				return new Response(`Unknown claimId: ${claimId}`, { status: 404 });
			if (claim.agentId !== body.agentId)
				return new Response(
					`Claim ${claimId} belongs to ${claim.agentId}, not ${body.agentId}.`,
					{ status: 409 },
				);
			if (claim.status !== "active")
				return new Response(`Claim ${claimId} is already ${claim.status}.`, {
					status: 409,
				});

			const releasedClaim = {
				...claim,
				status: "released" as const,
				releasedAt: nowIso(),
			};
			queue.claimsByProblemId[claim.problemId] = releasedClaim;
			await this.writeState(queue);
			return Response.json({ claim: releasedClaim });
		}

		const submitMatch = url.pathname.match(/^\/claims\/([^/]+)\/submit$/);
		if (submitMatch && request.method === "POST") {
			const claimId = decodeURIComponent(submitMatch[1]);
			const body = (await request.json()) as {
				agentId: string;
				title: string | null;
				summary: string;
				approach: string | null;
				evidence: string | null;
				artifactUrl: string | null;
				confidence: number | null;
			};
			const claim = Object.values(queue.claimsByProblemId).find(
				(entry) => entry.claimId === claimId,
			);

			if (!claim)
				return new Response(`Unknown claimId: ${claimId}`, { status: 404 });
			if (claim.agentId !== body.agentId)
				return new Response(
					`Claim ${claimId} belongs to ${claim.agentId}, not ${body.agentId}.`,
					{ status: 409 },
				);
			if (claim.status !== "active")
				return new Response(
					`Claim ${claimId} is ${claim.status} and cannot accept a submission.`,
					{ status: 409 },
				);

			const submission = createSubmissionRecord(claim, body);
			queue.solutionsByProblemId[claim.problemId] = [
				...(queue.solutionsByProblemId[claim.problemId] ?? []),
				submission,
			];
			queue.claimsByProblemId[claim.problemId] = {
				...claim,
				status: "submitted",
				releasedAt: submission.submittedAt,
			};
			await this.writeState(queue);
			return Response.json({
				claim: queue.claimsByProblemId[claim.problemId],
				submission,
			});
		}

		return new Response("Not found", { status: 404 });
	}
}

app.use(
	"*",
	cors({
		origin: "*",
		allowHeaders: [
			"Content-Type",
			"Accept",
			"Authorization",
			"MCP-Protocol-Version",
		],
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		exposeHeaders: ["MCP-Protocol-Version"],
	}),
);

app.get("/", (c) =>
	c.json({
		name: "unsolved-problems-api",
		version: APP_VERSION,
		upstream: getPagesOrigin(c.env),
		auth: {
			githubConfigured: Boolean(getGithubClientId(c.env)),
			localAuthEnabled: isLocalAuthEnabled(c.env),
			contributionAuthRequired: isContributionAuthRequired(c.env),
			bearer: "Authorization: Bearer <api_token>",
			login: "/auth/github",
			register: "/auth/register",
			passwordLogin: "/auth/login",
			me: "/auth/me",
			tokens: "/auth/tokens",
		},
		mcp: {
			endpoint: "/mcp",
			transport: "streamable-http",
			jsonResponsesOnly: true,
			contributionToolsRequireBearer: [
				"pick_problem",
				"release_problem",
				"submit_solution",
				"save_progress",
			],
			tools: [
				"list_problems",
				"pick_problem",
				"release_problem",
				"submit_solution",
				"save_progress",
				"search_web",
				"list_claims",
			],
			resources: [
				"open-questions://catalog",
				"open-questions://queue",
				"open-questions://problem/{problemId}",
			],
			prompts: ["work_problem"],
		},
		routes: [
			"/health",
			"/queue",
			"/mcp",
			"/auth/register",
			"/auth/login",
			"/auth/github",
			"/auth/github/callback",
			"/auth/me",
			"/auth/tokens",
			"/auth/logout",
			"/problems/:problemId",
			"/problems/:problemId/research",
			"/data/problems.json",
			"/data/enrichments.json",
			"/data/news.json",
			"/data/cases.json",
			"/data/news-history/index.json",
			"/data/news-history/YYYY-MM-DD.json",
			"/data/case-history/index.json",
			"/data/case-history/YYYY-MM-DD.json",
		],
	}),
);

app.get("/health", async (c) =>
	c.json({
		ok: true,
		cacheWarm: Boolean(cachedProblems),
		activeClaims: (await getQueueSnapshot(c.env)).activeClaims.length,
	}),
);

app.get("/queue", async (c) => c.json(await getQueueSnapshot(c.env)));

app.post("/auth/register", async (c) => {
	let body: { username?: string; password?: string; name?: string } = {};
	try {
		body = (await c.req.json()) as typeof body;
	} catch {
		return jsonError(
			"Request body must be JSON with username and password.",
			400,
		);
	}

	const result = await registerLocalAccount(
		{
			username: typeof body.username === "string" ? body.username : "",
			password: typeof body.password === "string" ? body.password : "",
			name: typeof body.name === "string" ? body.name : null,
		},
		c.env,
	);

	if (!result.ok) {
		return jsonError(result.error, result.status);
	}

	return c.json({
		sessionToken: result.sessionToken,
		expiresAt: result.session.expiresAt,
		user: result.user,
	});
});

app.post("/auth/login", async (c) => {
	let body: { username?: string; password?: string } = {};
	try {
		body = (await c.req.json()) as typeof body;
	} catch {
		return jsonError(
			"Request body must be JSON with username and password.",
			400,
		);
	}

	const result = await loginLocalAccount(
		{
			username: typeof body.username === "string" ? body.username : "",
			password: typeof body.password === "string" ? body.password : "",
		},
		c.env,
	);

	if (!result.ok) {
		return jsonError(result.error, result.status);
	}

	return c.json({
		sessionToken: result.sessionToken,
		expiresAt: result.session.expiresAt,
		user: result.user,
	});
});

app.get("/auth/github", async (c) => {
	const clientId = getGithubClientId(c.env);
	if (!clientId) {
		return jsonError(
			"GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the API, or use a local username/password account via /auth/register and /auth/login.",
			503,
		);
	}

	const returnToRaw =
		c.req.query("return_to") || `${getAuthPagesOrigin(c.env)}/`;
	if (!isSafeReturnTo(returnToRaw, c.env)) {
		return jsonError("return_to must point at the Catalog site origin.", 400);
	}

	const state = await createOAuthState(returnToRaw, c.env);

	const authorize = new URL("https://github.com/login/oauth/authorize");
	authorize.searchParams.set("client_id", clientId);
	authorize.searchParams.set("scope", "read:user");
	authorize.searchParams.set("state", state);
	const callbackUrl = new URL("/auth/github/callback", c.req.url);
	authorize.searchParams.set("redirect_uri", callbackUrl.toString());

	return c.redirect(authorize.toString(), 302);
});

app.get("/auth/github/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	if (!code || !state) {
		return jsonError("Missing OAuth code or state.", 400);
	}

	const returnTo = await verifyOAuthState(state, c.env);
	if (!returnTo) {
		return jsonError("OAuth state is invalid or expired.", 400);
	}

	try {
		const user = await exchangeGithubCode(code, c.env);
		const { sessionToken } = await createSession(user, c.env);
		const redirectUrl = new URL(returnTo);
		redirectUrl.hash = `auth_session=${encodeURIComponent(sessionToken)}`;
		return c.redirect(redirectUrl.toString(), 302);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "GitHub OAuth failed.";
		return jsonError(message, 502);
	}
});

app.get("/auth/me", async (c) => {
	const principal = await resolvePrincipal(c.req.raw, c.env);
	if (!principal) {
		return jsonError(
			"Unauthorized. Present Authorization: Bearer <token>.",
			401,
		);
	}
	return c.json({
		authenticated: true,
		kind: principal.kind,
		user: principal.user,
		tokenId: principal.tokenId ?? null,
		sessionId: principal.sessionId ?? null,
		label: principal.label ?? null,
		contributionAuthRequired: isContributionAuthRequired(c.env),
	});
});

app.post("/auth/logout", async (c) => {
	const principal = await resolvePrincipal(c.req.raw, c.env);
	if (!principal) {
		return jsonError("Unauthorized.", 401);
	}
	if (principal.kind === "session" && principal.sessionId) {
		await revokeSession(principal.sessionId, c.env);
	}
	return c.json({ ok: true });
});

app.get("/auth/tokens", async (c) => {
	const principal = await resolvePrincipal(c.req.raw, c.env);
	if (principal?.kind !== "session") {
		return jsonError(
			"Sign in (local account or GitHub) and present the session Bearer token to list API tokens.",
			401,
		);
	}
	const tokens = await listApiTokens(principal.user.id, c.env);
	return c.json({ tokens });
});

app.post("/auth/tokens", async (c) => {
	const principal = await resolvePrincipal(c.req.raw, c.env);
	if (principal?.kind !== "session") {
		return jsonError(
			"Sign in (local account or GitHub) and present the session Bearer token to create an API token.",
			401,
		);
	}

	let label = "Agent token";
	try {
		const body = (await c.req.json()) as { label?: string };
		if (typeof body.label === "string" && body.label.trim()) {
			label = body.label.trim().slice(0, 80);
		}
	} catch {
		// empty body is fine
	}

	const { token, record } = await createApiToken(principal.user, label, c.env);
	return c.json({
		token,
		tokenId: record.tokenId,
		tokenPrefix: record.tokenPrefix,
		label: record.label,
		createdAt: record.createdAt,
		warning:
			"Store this token securely. It is shown once and must be sent as Authorization: Bearer <token> for agent contributions.",
	});
});

app.delete("/auth/tokens/:tokenId", async (c) => {
	const principal = await resolvePrincipal(c.req.raw, c.env);
	if (principal?.kind !== "session") {
		return jsonError(
			"Sign in (local account or GitHub) and present the session Bearer token to revoke API tokens.",
			401,
		);
	}
	const tokenId = c.req.param("tokenId");
	const ok = await revokeApiToken(tokenId, principal.user.id, c.env);
	if (!ok) return jsonError("Token not found.", 404);
	return c.json({ ok: true });
});

/** Local/dev only: mint an API token without GitHub when ALLOW_DEV_AUTH=1. */
app.post("/auth/dev/token", async (c) => {
	if (!isDevAuthAllowed(c.env)) {
		return jsonError("Dev auth bootstrap is disabled.", 403);
	}
	let label = "Dev token";
	let login = "dev-user";
	try {
		const body = (await c.req.json()) as { label?: string; login?: string };
		if (typeof body.label === "string" && body.label.trim()) {
			label = body.label.trim().slice(0, 80);
		}
		if (typeof body.login === "string" && body.login.trim()) {
			login = body.login.trim().slice(0, 40);
		}
	} catch {
		// empty body is fine
	}

	const user = {
		id: 0,
		login,
		name: "Dev User",
		avatarUrl: null,
	};
	const { token, record } = await createApiToken(user, label, c.env);
	return c.json({
		token,
		...publicTokenView(record),
		warning: "Dev-only token. Do not enable ALLOW_DEV_AUTH in production.",
	});
});

app.get("/problems/:problemId", async (c) => {
	const problemId = c.req.param("problemId");
	const [problem, state] = await Promise.all([
		getProblem(problemId, c.env),
		readQueueState(c.env),
	]);

	if (!problem) {
		return jsonError(`Unknown problemId: ${problemId}`, 404);
	}

	return c.json({
		...(await summarizeProblem(problem, state)),
		activeClaim:
			state.claimsByProblemId[problemId]?.status === "active"
				? state.claimsByProblemId[problemId]
				: null,
		submissions: state.solutionsByProblemId[problemId] ?? [],
		researchEntries: substantiveResearchEntries(
			state.researchEntriesByProblemId[problemId],
		),
	});
});

app.get("/problems/:problemId/research", async (c) => {
	const problemId = c.req.param("problemId");
	const [problem, state] = await Promise.all([
		getProblem(problemId, c.env),
		readQueueState(c.env),
	]);

	if (!problem) {
		return jsonError(`Unknown problemId: ${problemId}`, 404);
	}

	return c.json({
		problemId,
		entries: substantiveResearchEntries(
			state.researchEntriesByProblemId[problemId],
		),
	});
});

app.all("/mcp", async (c) => {
	try {
		return await handleMcpRequest(c.req.raw, c.env);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Unhandled MCP server error.";
		return jsonError(message, 500);
	}
});

app.get("/data/*", async (c) => {
	const pathname = c.req.path;

	if (!isAllowedPath(pathname)) {
		return jsonError("Only approved JSON data files are available.", 404);
	}

	const upstreamUrl = buildUpstreamUrl(pathname, c.env);
	const upstream = await fetch(upstreamUrl, {
		headers: {
			accept: "application/json",
			"user-agent": "open-questions-json-proxy/1.0",
		},
	});

	if (!upstream.ok) {
		return jsonError(
			`Upstream responded with ${upstream.status}.`,
			upstream.status,
		);
	}

	const headers = new Headers({
		"access-control-allow-origin": "*",
		"x-proxied-from": upstreamUrl.toString(),
	});

	for (const header of FORWARDED_HEADERS) {
		const value = upstream.headers.get(header);
		if (value) headers.set(header, value);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		headers,
	});
});

app.notFound(() => jsonError("Not found.", 404));

/** Test helper: clear in-memory problem cache and queue state. */
export function resetLocalRuntimeStateForTests() {
	cachedProblems = undefined;
	queueStore = new JsonFileStateStore(
		getLocalStatePath(),
		emptyQueueState(),
		cloneQueueState,
	);
}

export default {
	fetch: app.fetch,
};
