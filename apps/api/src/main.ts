import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type Bindings = {
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

type ProblemRecord = {
  id: string;
  category: string;
  section: string;
  text: string;
  enrichment: Enrichment | null;
};

type ClaimStatus = "active" | "released" | "submitted" | "expired";

type ProblemClaim = {
  claimId: string;
  problemId: string;
  agentId: string;
  notes: string | null;
  pickedUpAt: string;
  leaseExpiresAt: string;
  status: ClaimStatus;
  releasedAt?: string;
};

type SubmittedSolution = {
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

type ResearchEntryKind = "note" | "reference" | "hypothesis" | "failed_attempt" | "handoff" | "candidate_approach";

type ResearchEntry = {
  entryId: string;
  problemId: string;
  agentId: string;
  kind: ResearchEntryKind;
  createdAt: string;
  title: string | null;
  content: string;
  artifactUrl: string | null;
};

type QueueState = {
  claimsByProblemId: Record<string, ProblemClaim>;
  solutionsByProblemId: Record<string, SubmittedSolution[]>;
  researchEntriesByProblemId: Record<string, ResearchEntry[]>;
};

type QueueSnapshot = {
  activeClaims: ProblemClaim[];
  submissions: SubmittedSolution[];
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
const DEFAULT_PAGES_ORIGIN = "https://geoffsee.github.io/unsolved-problems";

function getLocalStatePath() {
  try {
    const metaUrl = typeof import.meta !== "undefined" ? import.meta.url : undefined;
    if (typeof process === "undefined" || !process.versions?.node || typeof metaUrl !== "string" || !metaUrl.startsWith("file:")) {
      return null;
    }

    return process.env.UNSOLVED_STATE_PATH || fileURLToPath(new URL("../data/agent-queue.json", metaUrl));
  } catch {
    return null;
  }
}

const LOCAL_STATE_PATH = getLocalStatePath();

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

let localQueueState: QueueState = {
  claimsByProblemId: {},
  solutionsByProblemId: {},
  researchEntriesByProblemId: {},
};

let cachedProblems:
  | {
      expiresAt: number;
      problems: ProblemRecord[];
    }
  | undefined;

function getPagesOrigin(env?: Bindings) {
  return (env?.PAGES_ORIGIN || process.env.PAGES_ORIGIN || DEFAULT_PAGES_ORIGIN).replace(/\/+$/, "");
}

function isAllowedPath(pathname: string) {
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(pathname));
}

function buildUpstreamUrl(pathname: string, env?: Bindings) {
  return new URL(`${getPagesOrigin(env)}${pathname}`);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function stableHash(value: string) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeProblemId(category: string, section: string, text: string) {
  const material = `${category}::${section}::${normalizeText(text)}`;
  return `${slugify(category)}-${slugify(section)}-${stableHash(material)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

function cloneQueueState(state: QueueState): QueueState {
  const researchEntriesByProblemId = state.researchEntriesByProblemId ?? {};

  return {
    claimsByProblemId: Object.fromEntries(Object.entries(state.claimsByProblemId).map(([key, value]) => [key, { ...value }])),
    solutionsByProblemId: Object.fromEntries(
      Object.entries(state.solutionsByProblemId).map(([key, values]) => [key, values.map((value) => ({ ...value }))]),
    ),
    researchEntriesByProblemId: Object.fromEntries(
      Object.entries(researchEntriesByProblemId).map(([key, values]) => [key, values.map((value) => ({ ...value }))]),
    ),
  };
}

function readLocalQueueState() {
  if (LOCAL_STATE_PATH && existsSync(LOCAL_STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(LOCAL_STATE_PATH, "utf-8")) as QueueState;
    } catch {
      return cloneQueueState(localQueueState);
    }
  }

  return cloneQueueState(localQueueState);
}

function writeLocalQueueState(state: QueueState) {
  localQueueState = cloneQueueState(state);

  if (!LOCAL_STATE_PATH) return;

  try {
    mkdirSync(dirname(LOCAL_STATE_PATH), { recursive: true });
    writeFileSync(LOCAL_STATE_PATH, JSON.stringify(localQueueState, null, 2));
  } catch {
    // Ignore local persistence failures and continue serving from memory.
  }
}

function pruneExpiredClaims(state: QueueState) {
  const now = Date.now();
  let changed = false;

  for (const [problemId, claim] of Object.entries(state.claimsByProblemId)) {
    if (claim.status === "active" && new Date(claim.leaseExpiresAt).getTime() <= now) {
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

function createQueueSnapshot(state: QueueState): QueueSnapshot {
  const researchCountsByProblemId = Object.fromEntries(
    Object.entries(state.researchEntriesByProblemId).map(([problemId, entries]) => [problemId, entries.length]),
  );
  const lastResearchAtByProblemId = Object.fromEntries(
    Object.entries(state.researchEntriesByProblemId)
      .filter(([, entries]) => entries.length > 0)
      .map(([problemId, entries]) => [problemId, entries[entries.length - 1].createdAt]),
  );

  return {
    activeClaims: Object.values(state.claimsByProblemId).filter((claim) => claim.status === "active"),
    submissions: Object.values(state.solutionsByProblemId).flat(),
    researchCountsByProblemId,
    lastResearchAtByProblemId,
  };
}

function createClaimRecord(problemId: string, agentId: string, leaseMinutes: number, notes: string | null): ProblemClaim {
  return {
    claimId: `claim_${crypto.randomUUID()}`,
    problemId,
    agentId,
    notes,
    pickedUpAt: nowIso(),
    leaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000).toISOString(),
    status: "active",
  };
}

function createSubmissionRecord(
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

function createResearchEntryRecord(
  input: {
    problemId: string;
    agentId: string;
    kind: ResearchEntryKind;
    title: string | null;
    content: string;
    artifactUrl: string | null;
  },
): ResearchEntry {
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
      "user-agent": "unsolved-problems-mcp/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load ${pathname}: upstream returned ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function loadProblems(env?: Bindings) {
  const now = Date.now();
  if (cachedProblems && cachedProblems.expiresAt > now) {
    return cachedProblems.problems;
  }

  const [problemsPayload, enrichmentsPayload] = await Promise.all([
    fetchJson<ProblemsPayload>("/data/problems.json", env),
    fetchJson<EnrichmentsPayload>("/data/enrichments.json", env).catch(() => ({ problems: {} })),
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

async function callQueueObject(env: Bindings, path: string, init?: RequestInit) {
  const id = env.PROBLEM_QUEUE?.idFromName("global");
  const stub = id && env.PROBLEM_QUEUE?.get(id);

  if (!stub) {
    throw new Error("PROBLEM_QUEUE Durable Object binding is not configured.");
  }

  const response = await stub.fetch(`https://problem-queue.internal${path}`, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Queue request failed with ${response.status}.`);
  }

  return response.json();
}

async function readQueueState(env?: Bindings): Promise<QueueState> {
  if (env?.PROBLEM_QUEUE) {
    return cloneQueueState((await callQueueObject(env, "/state")) as QueueState);
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

async function createClaim(env: Bindings | undefined, problemId: string, agentId: string, leaseMinutes: number, notes: string | null) {
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

async function releaseClaim(env: Bindings | undefined, claimId: string, agentId: string) {
  if (env?.PROBLEM_QUEUE) {
    return (await callQueueObject(env, `/claims/${encodeURIComponent(claimId)}/release`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    })) as { claim: ProblemClaim };
  }

  const state = readLocalQueueState();
  if (pruneExpiredClaims(state)) {
    writeLocalQueueState(state);
  }

  const claim = Object.values(state.claimsByProblemId).find((entry) => entry.claimId === claimId);
  if (!claim) throw new Error(`Unknown claimId: ${claimId}`);
  if (claim.agentId !== agentId) throw new Error(`Claim ${claimId} belongs to ${claim.agentId}, not ${agentId}.`);
  if (claim.status !== "active") throw new Error(`Claim ${claimId} is already ${claim.status}.`);

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
    return (await callQueueObject(env, `/claims/${encodeURIComponent(input.claimId)}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })) as { claim: ProblemClaim; submission: SubmittedSolution };
  }

  const state = readLocalQueueState();
  if (pruneExpiredClaims(state)) {
    writeLocalQueueState(state);
  }

  const claim = Object.values(state.claimsByProblemId).find((entry) => entry.claimId === input.claimId);
  if (!claim) throw new Error(`Unknown claimId: ${input.claimId}`);
  if (claim.agentId !== input.agentId) throw new Error(`Claim ${input.claimId} belongs to ${claim.agentId}, not ${input.agentId}.`);
  if (claim.status !== "active") throw new Error(`Claim ${input.claimId} is ${claim.status} and cannot accept a submission.`);

  const submission = createSubmissionRecord(claim, input);
  state.solutionsByProblemId[claim.problemId] = [...(state.solutionsByProblemId[claim.problemId] ?? []), submission];
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
  state.researchEntriesByProblemId[input.problemId] = [...(state.researchEntriesByProblemId[input.problemId] ?? []), entry];
  writeLocalQueueState(state);

  return { entry };
}

async function summarizeProblem(problem: ProblemRecord, state: QueueState) {
  const claim = state.claimsByProblemId[problem.id];
  const status = claim?.status === "active" ? "claimed" : (state.solutionsByProblemId[problem.id]?.length ?? 0) > 0 ? "submitted" : "available";

  return {
    id: problem.id,
    category: problem.category,
    section: problem.section,
    text: problem.text,
    status,
    enrichment: problem.enrichment,
    researchEntryCount: state.researchEntriesByProblemId[problem.id]?.length ?? 0,
    lastResearchAt: state.researchEntriesByProblemId[problem.id]?.at(-1)?.createdAt ?? null,
  };
}

async function filterProblems(
  problems: ProblemRecord[],
  state: QueueState,
  filters: {
    category?: string;
    query?: string;
    status?: "available" | "claimed" | "submitted" | "all";
  },
) {
  const normalizedCategory = filters.category?.trim().toLowerCase();
  const normalizedQuery = filters.query ? normalizeText(filters.query).toLowerCase() : null;

  return problems.filter((problem) => {
    const claim = state.claimsByProblemId[problem.id];
    const queueStatus = claim?.status === "active" ? "claimed" : (state.solutionsByProblemId[problem.id]?.length ?? 0) > 0 ? "submitted" : "available";

    if (normalizedCategory && problem.category.toLowerCase() !== normalizedCategory) return false;
    if (filters.status && filters.status !== "all" && queueStatus !== filters.status) return false;

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

function createCatalogSummary(problems: ProblemRecord[], state: QueueState) {
  const categories = problems.reduce<Record<string, number>>((acc, problem) => {
    acc[problem.category] = (acc[problem.category] ?? 0) + 1;
    return acc;
  }, {});

  const availableProblems = problems.filter((problem) => !state.claimsByProblemId[problem.id] && !(state.solutionsByProblemId[problem.id]?.length ?? 0)).length;
  const claimedProblems = Object.values(state.claimsByProblemId).filter((claim) => claim.status === "active").length;
  const submittedProblems = Object.values(state.solutionsByProblemId).filter((items) => items.length > 0).length;
  const researchProblems = Object.values(state.researchEntriesByProblemId).filter((items) => items.length > 0).length;

  return {
    totalProblems: problems.length,
    availableProblems,
    claimedProblems,
    submittedProblems,
    researchProblems,
    categories,
  };
}

function createMcpServer(env?: Bindings) {
  const server = new McpServer({
    name: "unsolved-problems",
    version: APP_VERSION,
  });

  server.registerResource(
    "catalog",
    "unsolved://catalog",
    {
      title: "Problem catalog",
      description: "Summary metadata for the unsolved-problems queue.",
      mimeType: "application/json",
    },
    async (uri) => {
      const [problems, state] = await Promise.all([loadProblems(env), readQueueState(env)]);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(createCatalogSummary(problems, state), null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "queue",
    "unsolved://queue",
    {
      title: "Queue state",
      description: "Active claims and submitted solutions currently tracked by the MCP server.",
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
    new ResourceTemplate("unsolved://problem/{problemId}", { list: undefined }),
    {
      title: "Problem detail",
      description: "Detailed metadata for a single problem.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const problemId = String(variables.problemId ?? "");
      const [problem, state] = await Promise.all([getProblem(problemId, env), readQueueState(env)]);

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
                activeClaim: state.claimsByProblemId[problemId]?.status === "active" ? state.claimsByProblemId[problemId] : null,
                submissions: state.solutionsByProblemId[problemId] ?? [],
                researchEntries: state.researchEntriesByProblemId[problemId] ?? [],
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
      description: "Generate a research-oriented work plan for a claimed problem before submitting a solution.",
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
                problem.enrichment?.summary ? `Summary: ${problem.enrichment.summary}` : null,
                "Produce a concrete plan, identify assumptions, and when ready submit a concise candidate solution with evidence and confidence.",
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
      description: "List unsolved problems that agents can pick up.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        category: z.string().optional(),
        query: z.string().optional(),
        status: z.enum(["available", "claimed", "submitted", "all"]).optional().default("available"),
        limit: z.number().int().min(1).max(MAX_PICK_LIMIT).optional().default(DEFAULT_PICK_LIMIT),
      }),
    },
    async ({ category, query, status, limit }) => {
      const [problems, state] = await Promise.all([loadProblems(env), readQueueState(env)]);
      const filtered = await filterProblems(problems, state, { category, query, status });
      const items = filtered.slice(0, limit);
      const summarized = await Promise.all(items.map((problem) => summarizeProblem(problem, state)));

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
        leaseMinutes: z.number().int().min(1).max(MAX_LEASE_MINUTES).optional().default(DEFAULT_LEASE_MINUTES),
        notes: z.string().optional(),
      }),
    },
    async ({ agentId, problemId, category, query, leaseMinutes, notes }) => {
      const normalizedAgentId = normalizeText(agentId);
      const [problems, state] = await Promise.all([loadProblems(env), readQueueState(env)]);

      let selected: ProblemRecord | undefined;
      if (problemId) {
        selected = problems.find((problem) => problem.id === problemId);
      } else {
        selected = (await filterProblems(problems, state, { category, query, status: "available" }))[0];
      }

      if (!selected) {
        return {
          content: textContent(problemId ? `Unknown or unavailable problemId: ${problemId}` : "No available problem matched the request."),
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
          content: textContent(`Problem ${selected.id} already has a submitted solution.`),
          structuredContent: {
            problem: await summarizeProblem(selected, state),
            submissions: state.solutionsByProblemId[selected.id],
          },
          isError: true,
        };
      }

      const result = await createClaim(env, selected.id, normalizedAgentId, leaseMinutes, notes ? normalizeText(notes) : null);
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
      try {
        const result = await releaseClaim(env, claimId, normalizeText(agentId));
        return {
          content: textContent(`Released ${result.claim.problemId} from ${result.claim.agentId}.`),
          structuredContent: {
            claim: result.claim,
          },
        };
      } catch (error) {
        return {
          content: textContent(error instanceof Error ? error.message : "Unable to release claim."),
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "submit_solution",
    {
      title: "Submit Solution",
      description: "Submit a solution for a previously claimed problem.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
      inputSchema: z.object({
        claimId: z.string(),
        agentId: z.string().min(1),
        title: z.string().optional(),
        summary: z.string().min(1),
        approach: z.string().optional(),
        evidence: z.string().optional(),
        artifactUrl: z.string().url().optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    },
    async ({ claimId, agentId, title, summary, approach, evidence, artifactUrl, confidence }) => {
      try {
        const normalizedAgentId = normalizeText(agentId);
        const result = await submitClaimSolution(env, {
          claimId,
          agentId: normalizedAgentId,
          title: title ? normalizeText(title) : null,
          summary: normalizeText(summary),
          approach: approach ? normalizeText(approach) : null,
          evidence: evidence ? normalizeText(evidence) : null,
          artifactUrl: artifactUrl ?? null,
          confidence: confidence ?? null,
        });
        const [problem, state] = await Promise.all([getProblem(result.claim.problemId, env), readQueueState(env)]);

        if (!problem) {
          throw new Error(`Problem ${result.claim.problemId} no longer exists in the catalog.`);
        }

        return {
          content: textContent(
            [
              `Submitted solution ${result.submission.submissionId} for ${problem.id}.`,
              result.submission.title ? `Title: ${result.submission.title}` : null,
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
          content: textContent(error instanceof Error ? error.message : "Unable to submit solution."),
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "save_progress",
    {
      title: "Save Progress",
      description: "Append a research note, reference, hypothesis, or handoff record to a problem.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: z.object({
        problemId: z.string(),
        agentId: z.string().min(1),
        kind: z.enum(["note", "reference", "hypothesis", "failed_attempt", "handoff", "candidate_approach"]).optional().default("note"),
        title: z.string().optional(),
        content: z.string().min(1),
        artifactUrl: z.string().url().optional(),
      }),
    },
    async ({ problemId, agentId, kind, title, content, artifactUrl }) => {
      const problem = await getProblem(problemId, env);
      if (!problem) {
        return {
          content: textContent(`Unknown problemId: ${problemId}`),
          isError: true,
        };
      }

      const result = await appendResearchEntry(env, {
        problemId,
        agentId: normalizeText(agentId),
        kind,
        title: title ? normalizeText(title) : null,
        content: normalizeText(content),
        artifactUrl: artifactUrl ?? null,
      });

      return {
        content: textContent(`Saved ${kind} entry ${result.entry.entryId} for ${problemId}.`),
        structuredContent: {
          problem: await summarizeProblem(problem, await readQueueState(env)),
          entry: result.entry,
        },
      };
    },
  );

  server.registerTool(
    "list_claims",
    {
      title: "List Claims",
      description: "Inspect active and historical claims, optionally filtered by agent.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        agentId: z.string().optional(),
        status: z.enum(["active", "released", "submitted", "expired", "all"]).optional().default("active"),
      }),
    },
    async ({ agentId, status }) => {
      const normalizedAgentId = agentId ? normalizeText(agentId) : null;
      const claims = (await listClaims(env)).filter((claim) => {
        if (normalizedAgentId && claim.agentId !== normalizedAgentId) return false;
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
  const server = createMcpServer(env);
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
    const queue = cloneQueueState(stored ?? { claimsByProblemId: {}, solutionsByProblemId: {}, researchEntriesByProblemId: {} });
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
      queue.researchEntriesByProblemId[body.problemId] = [...(queue.researchEntriesByProblemId[body.problemId] ?? []), entry];
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
        return new Response(`Problem ${body.problemId} is already claimed.`, { status: 409 });
      }

      if ((queue.solutionsByProblemId[body.problemId]?.length ?? 0) > 0) {
        return new Response(`Problem ${body.problemId} already has a submitted solution.`, { status: 409 });
      }

      const claim = createClaimRecord(body.problemId, body.agentId, body.leaseMinutes, body.notes);
      queue.claimsByProblemId[body.problemId] = claim;
      await this.writeState(queue);
      return Response.json({ claim });
    }

    const releaseMatch = url.pathname.match(/^\/claims\/([^/]+)\/release$/);
    if (releaseMatch && request.method === "POST") {
      const claimId = decodeURIComponent(releaseMatch[1]);
      const body = (await request.json()) as { agentId: string };
      const claim = Object.values(queue.claimsByProblemId).find((entry) => entry.claimId === claimId);

      if (!claim) return new Response(`Unknown claimId: ${claimId}`, { status: 404 });
      if (claim.agentId !== body.agentId) return new Response(`Claim ${claimId} belongs to ${claim.agentId}, not ${body.agentId}.`, { status: 409 });
      if (claim.status !== "active") return new Response(`Claim ${claimId} is already ${claim.status}.`, { status: 409 });

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
      const claim = Object.values(queue.claimsByProblemId).find((entry) => entry.claimId === claimId);

      if (!claim) return new Response(`Unknown claimId: ${claimId}`, { status: 404 });
      if (claim.agentId !== body.agentId) return new Response(`Claim ${claimId} belongs to ${claim.agentId}, not ${body.agentId}.`, { status: 409 });
      if (claim.status !== "active") return new Response(`Claim ${claimId} is ${claim.status} and cannot accept a submission.`, { status: 409 });

      const submission = createSubmissionRecord(claim, body);
      queue.solutionsByProblemId[claim.problemId] = [...(queue.solutionsByProblemId[claim.problemId] ?? []), submission];
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
    allowHeaders: ["Content-Type", "Accept", "MCP-Protocol-Version"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    exposeHeaders: ["MCP-Protocol-Version"],
  }),
);

app.get("/", (c) =>
  c.json({
    name: "unsolved-problems-api",
    version: APP_VERSION,
    upstream: getPagesOrigin(c.env),
    mcp: {
      endpoint: "/mcp",
      transport: "streamable-http",
      jsonResponsesOnly: true,
      tools: ["list_problems", "pick_problem", "release_problem", "submit_solution", "save_progress", "list_claims"],
      resources: ["unsolved://catalog", "unsolved://queue", "unsolved://problem/{problemId}"],
      prompts: ["work_problem"],
    },
    routes: [
      "/health",
      "/queue",
      "/mcp",
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

app.get("/problems/:problemId", async (c) => {
  const problemId = c.req.param("problemId");
  const [problem, state] = await Promise.all([getProblem(problemId, c.env), readQueueState(c.env)]);

  if (!problem) {
    return jsonError(`Unknown problemId: ${problemId}`, 404);
  }

  return c.json({
    ...(await summarizeProblem(problem, state)),
    activeClaim: state.claimsByProblemId[problemId]?.status === "active" ? state.claimsByProblemId[problemId] : null,
    submissions: state.solutionsByProblemId[problemId] ?? [],
    researchEntries: state.researchEntriesByProblemId[problemId] ?? [],
  });
});

app.get("/problems/:problemId/research", async (c) => {
  const problemId = c.req.param("problemId");
  const [problem, state] = await Promise.all([getProblem(problemId, c.env), readQueueState(c.env)]);

  if (!problem) {
    return jsonError(`Unknown problemId: ${problemId}`, 404);
  }

  return c.json({
    problemId,
    entries: state.researchEntriesByProblemId[problemId] ?? [],
  });
});

app.all("/mcp", async (c) => {
  try {
    return await handleMcpRequest(c.req.raw, c.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled MCP server error.";
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
      "user-agent": "unsolved-problems-json-proxy/1.0",
    },
  });

  if (!upstream.ok) {
    return jsonError(`Upstream responded with ${upstream.status}.`, upstream.status);
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

export default {
  fetch: app.fetch,
};
