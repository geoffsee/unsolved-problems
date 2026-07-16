import { pickRandomProblemId } from "./openaiHelpers";

export type ResolvedPick = {
	pickMode: string;
	specificProblemId: string | null;
	poolSize?: number;
};

function parseJsonPayload(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return JSON.parse(trimmed);
	}

	const dataLines = trimmed
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter(Boolean);

	if (dataLines.length === 0) {
		throw new Error("MCP response did not include JSON or SSE data.");
	}

	return JSON.parse(dataLines[dataLines.length - 1] ?? "");
}

export function extractProblemIdsFromListResult(payload: unknown): string[] {
	const root = payload as {
		result?: {
			structuredContent?: { items?: Array<{ id?: unknown }> };
			content?: Array<{ type?: string; text?: string }>;
		};
		structuredContent?: { items?: Array<{ id?: unknown }> };
	};

	const items =
		root.result?.structuredContent?.items ?? root.structuredContent?.items;
	if (Array.isArray(items) && items.length > 0) {
		return items
			.map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
			.filter(Boolean);
	}

	const text = (root.result?.content ?? [])
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");

	return text
		.split("\n")
		.map(
			(line) =>
				line.match(
					/^\d+\.\s+([^\s]+)\s+\[(available|claimed|submitted)\]/,
				)?.[1],
		)
		.filter((value): value is string => Boolean(value));
}

export async function listAvailableProblemIds(
	mcpUrl: string,
	limit = 25,
): Promise<string[]> {
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
			params: {
				name: "list_problems",
				arguments: { limit, status: "available" },
			},
		}),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`list_problems failed (${response.status}): ${text.slice(0, 400)}`,
		);
	}

	return extractProblemIdsFromListResult(parseJsonPayload(text));
}

/**
 * Resolve pick mode before the agent runs.
 * "random" is decided in process (not by the model) so morning runs don't
 * keep claiming the same LLM-favored problem.
 */
export async function resolveRuntimePick(input: {
	pickMode: string;
	specificProblemId?: string | null;
	mcpUrl: string;
	limit?: number;
}): Promise<ResolvedPick> {
	if (input.pickMode === "specific") {
		if (!input.specificProblemId) {
			throw new Error(
				"UNSOLVED_PROBLEM_ID is required when UNSOLVED_PICK_MODE=specific.",
			);
		}
		return {
			pickMode: "specific",
			specificProblemId: input.specificProblemId,
		};
	}

	if (input.pickMode !== "random") {
		return {
			pickMode: input.pickMode,
			specificProblemId: input.specificProblemId ?? null,
		};
	}

	const candidateIds = await listAvailableProblemIds(
		input.mcpUrl,
		input.limit ?? 25,
	);
	const chosenProblemId = pickRandomProblemId(candidateIds);

	return {
		pickMode: "specific",
		specificProblemId: chosenProblemId,
		poolSize: candidateIds.length,
	};
}
