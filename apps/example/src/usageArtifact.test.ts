import { describe, expect, mock, test } from "bun:test";
import {
	buildUsageArtifactPayload,
	extractProblemIdFromUnknown,
	formatUsageMarkdown,
	saveUsageArtifact,
	type UsageArtifactInput,
} from "./usageArtifact";

function silentLogger() {
	return {
		child: () => silentLogger(),
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
	};
}

const sampleInput: UsageArtifactInput = {
	mcpUrl: "https://example.test/mcp",
	problemId: "math-001",
	agentId: "openai-1",
	provider: "openai",
	model: "gpt-4.1",
	totals: {
		inputTokens: 10,
		outputTokens: 4,
		totalTokens: 14,
		empty: "",
		missing: null,
	},
	details: { requests: 1 },
};

describe("usageArtifact formatting", () => {
	test("renders a markdown table of reported totals", () => {
		const markdown = formatUsageMarkdown(sampleInput);
		expect(markdown).toContain("`openai`");
		expect(markdown).toContain("`openai-1`");
		expect(markdown).toContain("| inputTokens | 10 |");
		expect(markdown).toContain("| outputTokens | 4 |");
		expect(markdown).not.toContain("| empty |");
		expect(markdown).not.toContain("| missing |");
	});

	test("builds a machine-readable payload", () => {
		const payload = buildUsageArtifactPayload(sampleInput);
		expect(payload.provider).toBe("openai");
		expect(payload.problemId).toBe("math-001");
		expect(payload.totals.totalTokens).toBe(14);
		expect(payload.details).toEqual({ requests: 1 });
		expect(typeof payload.recordedAt).toBe("string");
	});
});

describe("extractProblemIdFromUnknown", () => {
	test("reads camelCase and snake_case ids", () => {
		expect(extractProblemIdFromUnknown({ problemId: " math-001 " })).toBe(
			"math-001",
		);
		expect(extractProblemIdFromUnknown({ problem_id: "bio-2" })).toBe("bio-2");
	});

	test("returns null for missing or invalid values", () => {
		expect(extractProblemIdFromUnknown(null)).toBeNull();
		expect(extractProblemIdFromUnknown("math-001")).toBeNull();
		expect(extractProblemIdFromUnknown({ problemId: "   " })).toBeNull();
	});
});

describe("saveUsageArtifact", () => {
	test("logs usage without calling save_progress", async () => {
		const infoCalls: Array<[string, Record<string, unknown>?]> = [];
		const callTool = mock(async () => ({ ok: true }));
		const logger = {
			...silentLogger(),
			info: (message: string, attributes?: Record<string, unknown>) => {
				infoCalls.push([message, attributes]);
			},
		};

		const payload = await saveUsageArtifact(logger, {
			...sampleInput,
			provider: "anthropic",
			callTool,
		});

		expect(payload.provider).toBe("anthropic");
		expect(callTool).not.toHaveBeenCalled();
		expect(infoCalls).toHaveLength(1);
		expect(infoCalls[0]?.[0]).toBe("token usage");
		expect(infoCalls[0]?.[1]).toMatchObject({
			problemId: "math-001",
			provider: "anthropic",
			model: "gpt-4.1",
		});
	});
});
