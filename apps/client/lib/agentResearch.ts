export const AGENT_RESEARCH_API_ORIGIN =
  "https://unsolved-problems-api.seemueller.workers.dev";

export interface LiveClaim {
  claimId: string;
  problemId: string;
  agentId: string;
  leaseExpiresAt: string;
  status: string;
}

export interface ResearchEntry {
  entryId: string;
  problemId: string;
  agentId: string;
  kind: string;
  createdAt: string;
  title: string | null;
  content: string;
  artifactUrl: string | null;
}

export interface QueueSnapshot {
  activeClaims: LiveClaim[];
  submissions: Array<{ problemId: string }>;
  researchCountsByProblemId: Record<string, number>;
  lastResearchAtByProblemId: Record<string, string>;
}

export type LiveProblemState = {
  activeClaim: LiveClaim | null;
  researchCount: number;
  lastResearchAt: string | null;
  hasSubmissions: boolean;
};

export async function fetchQueueSnapshot(signal?: AbortSignal): Promise<QueueSnapshot> {
  const response = await fetch(`${AGENT_RESEARCH_API_ORIGIN}/queue`, { signal });
  if (!response.ok) {
    throw new Error(`Queue request failed with ${response.status}`);
  }

  return response.json();
}

export async function fetchProblemResearch(problemId: string, signal?: AbortSignal): Promise<ResearchEntry[]> {
  const response = await fetch(`${AGENT_RESEARCH_API_ORIGIN}/problems/${encodeURIComponent(problemId)}/research`, { signal });
  if (!response.ok) {
    throw new Error(`Research request failed with ${response.status}`);
  }

  const payload = (await response.json()) as { entries?: ResearchEntry[] };
  return payload.entries ?? [];
}
