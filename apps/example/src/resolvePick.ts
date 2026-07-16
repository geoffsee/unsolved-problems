import { pickRandomProblemId } from "./openaiHelpers";

export type ResolvedPick = {
	pickMode: string;
	specificProblemId: string | null;
	poolSize?: number;
	category?: string | null;
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

export function extractCategoriesFromListResult(payload: unknown): string[] {
	const root = payload as {
		result?: {
			structuredContent?: {
				categories?: Record<string, unknown>;
				items?: Array<{ category?: unknown }>;
			};
		};
		structuredContent?: {
			categories?: Record<string, unknown>;
			items?: Array<{ category?: unknown }>;
		};
	};

	const categories =
		root.result?.structuredContent?.categories ??
		root.structuredContent?.categories;

	if (categories && typeof categories === "object") {
		return Object.entries(categories)
			.filter(([, count]) => typeof count === "number" && count > 0)
			.map(([name]) => name)
			.sort((a, b) => a.localeCompare(b));
	}

	const items =
		root.result?.structuredContent?.items ?? root.structuredContent?.items;
	if (!Array.isArray(items)) return [];

	return [
		...new Set(
			items
				.map((item) =>
					typeof item?.category === "string" ? item.category.trim() : "",
				)
				.filter(Boolean),
		),
	].sort((a, b) => a.localeCompare(b));
}

export function extractCategoriesFromCatalog(payload: unknown): string[] {
	const root = payload as {
		result?: { contents?: Array<{ text?: string }> };
		contents?: Array<{ text?: string }>;
	};
	const text =
		root.result?.contents?.find((item) => typeof item.text === "string")
			?.text ??
		root.contents?.find((item) => typeof item.text === "string")?.text;

	if (!text) return [];

	const catalog = JSON.parse(text) as {
		categories?: Record<string, unknown>;
	};
	if (!catalog.categories || typeof catalog.categories !== "object") {
		return [];
	}

	return Object.entries(catalog.categories)
		.filter(([, count]) => typeof count === "number" && count > 0)
		.map(([name]) => name)
		.sort((a, b) => a.localeCompare(b));
}

export function pickRandomCategory(categories: string[]): string {
	if (categories.length === 0) {
		throw new Error("No available problem categories were returned.");
	}

	return categories[Math.floor(Math.random() * categories.length)]!;
}

async function callMcp(
	mcpUrl: string,
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
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
			method,
			params,
		}),
	});

	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`${method} failed (${response.status}): ${text.slice(0, 400)}`,
		);
	}

	return parseJsonPayload(text);
}

export async function listAvailableProblemIds(
	mcpUrl: string,
	limit = 25,
	category?: string,
): Promise<{ candidateIds: string[]; categories: string[] }> {
	const payload = await callMcp(mcpUrl, "tools/call", {
		name: "list_problems",
		arguments: {
			limit,
			status: "available",
			...(category ? { category } : {}),
		},
	});

	return {
		candidateIds: extractProblemIdsFromListResult(payload),
		categories: extractCategoriesFromListResult(payload),
	};
}

export async function listCatalogCategories(mcpUrl: string): Promise<string[]> {
	const payload = await callMcp(mcpUrl, "resources/read", {
		uri: "unsolved://catalog",
	});
	return extractCategoriesFromCatalog(payload);
}

/**
 * Resolve pick mode before the agent runs.
 * "random" is decided in process (not by the model) so morning runs don't
 * keep claiming the same LLM-favored problem.
 *
 * Random mode first shuffles a category filter, then picks uniformly within
 * that category — avoiding the astronomy-first bias of unfiltered shortlists.
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

	const limit = input.limit ?? 25;
	const discovery = await listAvailableProblemIds(input.mcpUrl, 1);
	let remaining =
		discovery.categories.length > 0
			? [...discovery.categories]
			: await listCatalogCategories(input.mcpUrl);

	while (remaining.length > 0) {
		const category = pickRandomCategory(remaining);
		const { candidateIds } = await listAvailableProblemIds(
			input.mcpUrl,
			limit,
			category,
		);
		if (candidateIds.length > 0) {
			return {
				pickMode: "specific",
				specificProblemId: pickRandomProblemId(candidateIds),
				poolSize: candidateIds.length,
				category,
			};
		}
		remaining = remaining.filter((name) => name !== category);
	}

	throw new Error("No available problems found in any category.");
}
