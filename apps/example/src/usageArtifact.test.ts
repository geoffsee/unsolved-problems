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
	test("saves through an injected callTool helper", async () => {
		const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
		const logger = silentLogger();

		const payload = await saveUsageArtifact(logger, {
			...sampleInput,
			provider: "anthropic",
			callTool: async (name, args) => {
				calls.push({ name, args });
				return { ok: true };
			},
		});

		expect(payload.provider).toBe("anthropic");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.name).toBe("save_progress");
		expect(calls[0]?.args.problemId).toBe("math-001");
		expect(calls[0]?.args.kind).toBe("note");
		expect(String(calls[0]?.args.artifactUrl)).toStartWith(
			"data:application/json;charset=utf-8,",
		);
		expect(logger.info).toHaveBeenCalled();
	});

	test("propagates callTool failures", async () => {
		const logger = silentLogger();
		await expect(
			saveUsageArtifact(logger, {
				...sampleInput,
				provider: "cursor",
				callTool: async () => {
					throw new Error("mcp down");
				},
			}),
		).rejects.toThrow("mcp down");
		expect(logger.error).toHaveBeenCalled();
	});
});
