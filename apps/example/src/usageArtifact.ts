import type { Logger } from "./logger";
import { truncate } from "./logger";

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

function encodeDataUri(mediaType: string, value: string) {
	return `data:${mediaType};charset=utf-8,${encodeURIComponent(value)}`;
}

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
		"",
		"Machine-readable totals are attached as the artifact JSON.",
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

async function mcpCall(
	mcpUrl: string,
	name: string,
	args: Record<string, unknown>,
) {
	const response = await fetch(mcpUrl, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			"mcp-protocol-version": "2025-03-26",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		}),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`MCP ${name} failed (${response.status}): ${text.slice(0, 400)}`,
		);
	}

	return text;
}

export async function saveUsageArtifact(
	logger: Logger,
	input: UsageArtifactInput,
) {
	const payload = buildUsageArtifactPayload(input);
	const content = formatUsageMarkdown(input);
	const artifactUrl = encodeDataUri(
		"application/json",
		JSON.stringify(payload, null, 2),
	);

	const args = {
		problemId: input.problemId,
		agentId: input.agentId,
		kind: "note",
		title: "Agent run token usage",
		content,
		artifactUrl,
	};

	logger.info("saving token usage artifact", {
		problemId: input.problemId,
		provider: input.provider,
		totals: input.totals,
		artifactChars: artifactUrl.length,
	});

	try {
		if (input.callTool) {
			const response = await input.callTool("save_progress", args);
			logger.info("token usage artifact saved", {
				problemId: input.problemId,
				response: truncate(response),
			});
		} else {
			const responseText = await mcpCall(input.mcpUrl, "save_progress", args);
			logger.info("token usage artifact saved", {
				problemId: input.problemId,
				response: truncate(responseText),
			});
		}
		return payload;
	} catch (error) {
		logger.error("failed to save token usage artifact", {
			problemId: input.problemId,
			err: error,
		});
		throw error;
	}
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
