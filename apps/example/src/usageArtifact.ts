import type { Logger } from "./logger";

export type UsageTotals = Record<string, number | string | null | undefined>;

export type UsageArtifactInput = {
	mcpUrl: string;
	problemId: string;
	agentId: string;
	provider: "openai" | "anthropic" | "cursor";
	model: string;
	totals: UsageTotals;
	details?: unknown;
	callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};

export function formatUsageMarkdown(input: UsageArtifactInput) {
	const rows = Object.entries(input.totals)
		.filter(
			([, value]) => value !== null && value !== undefined && value !== "",
		)
		.map(([key, value]) => `| ${key} | ${String(value)} |`)
		.join("\n");

	return [
		`Token usage for \`${input.provider}\` agent \`${input.agentId}\`.`,
		"",
		`Model: \`${input.model}\``,
		`Problem: \`${input.problemId}\``,
		"",
		"| Metric | Value |",
		"| --- | --- |",
		rows || "| (none reported) | — |",
	].join("\n");
}

export function buildUsageArtifactPayload(input: UsageArtifactInput) {
	return {
		provider: input.provider,
		model: input.model,
		agentId: input.agentId,
		problemId: input.problemId,
		recordedAt: new Date().toISOString(),
		totals: input.totals,
		details: input.details ?? null,
	};
}

/**
 * Record token usage in the agent log only.
 * Do not publish usage via save_progress — that pollutes the research feed.
 */
export async function saveUsageArtifact(
	logger: Logger,
	input: UsageArtifactInput,
) {
	const payload = buildUsageArtifactPayload(input);
	logger.info("token usage", {
		problemId: input.problemId,
		provider: input.provider,
		model: input.model,
		totals: input.totals,
	});
	return payload;
}

export function extractProblemIdFromUnknown(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (typeof record.problemId === "string" && record.problemId.trim()) {
		return record.problemId.trim();
	}
	if (typeof record.problem_id === "string" && record.problem_id.trim()) {
		return record.problem_id.trim();
	}
	return null;
}
