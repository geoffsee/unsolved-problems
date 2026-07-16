import {
	tool as anthropicTool,
	createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { tool as openAITool } from "@openai/agents";
import { z } from "zod";
import {
	ANTHROPIC_SANDBOX_ALLOWED_TOOLS,
	RUN_CODE_TOOL_NAME,
	SANDBOX_MCP_SERVER_NAME,
} from "./constants";
import {
	formatSandboxResult,
	RUN_CODE_TOOL_DESCRIPTION,
	type RunSandboxCodeInput,
	runSandboxCode,
	SANDBOX_LANGUAGES,
} from "./runCode";

export {
	ANTHROPIC_SANDBOX_ALLOWED_TOOLS,
	RUN_CODE_TOOL_NAME,
	SANDBOX_MCP_SERVER_NAME,
} from "./constants";

const languageSchema = z.enum(SANDBOX_LANGUAGES);

export const runCodeParametersSchema = z.object({
	language: languageSchema.describe(
		"Runtime to use: python, javascript, or typescript.",
	),
	code: z
		.string()
		.min(1)
		.describe("Full program source to execute as the entrypoint."),
	files: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Optional extra files to materialize in the sandbox workspace (relative paths only).",
		),
	args: z
		.array(z.string())
		.optional()
		.describe("Optional argv passed to the program after the entrypoint."),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.max(120_000)
		.optional()
		.describe(
			"Wall-clock timeout in milliseconds (default 30000, max 120000).",
		),
});

export type RunCodeToolArgs = z.infer<typeof runCodeParametersSchema>;

export async function executeRunCodeTool(
	args: RunCodeToolArgs,
): Promise<string> {
	const input: RunSandboxCodeInput = {
		language: args.language,
		code: args.code,
		files: args.files,
		args: args.args,
		timeoutMs: args.timeoutMs,
	};
	const result = await runSandboxCode(input);
	return formatSandboxResult(result);
}

/** OpenAI Agents SDK function tool. */
export function createOpenAISandboxTool() {
	return openAITool({
		name: RUN_CODE_TOOL_NAME,
		description: RUN_CODE_TOOL_DESCRIPTION,
		parameters: runCodeParametersSchema,
		execute: async (args) => executeRunCodeTool(args),
	});
}

/**
 * In-process MCP server for the Anthropic Claude Agent SDK.
 * Tools appear as mcp__code_sandbox__run_code.
 */
export function createAnthropicSandboxMcpServer() {
	return createSdkMcpServer({
		name: SANDBOX_MCP_SERVER_NAME,
		version: "1.0.0",
		tools: [
			anthropicTool(
				RUN_CODE_TOOL_NAME,
				RUN_CODE_TOOL_DESCRIPTION,
				{
					language: languageSchema.describe(
						"Runtime to use: python, javascript, or typescript.",
					),
					code: z
						.string()
						.min(1)
						.describe("Full program source to execute as the entrypoint."),
					files: z
						.record(z.string(), z.string())
						.optional()
						.describe(
							"Optional extra files to materialize in the sandbox workspace (relative paths only).",
						),
					args: z
						.array(z.string())
						.optional()
						.describe(
							"Optional argv passed to the program after the entrypoint.",
						),
					timeoutMs: z
						.number()
						.int()
						.positive()
						.max(120_000)
						.optional()
						.describe(
							"Wall-clock timeout in milliseconds (default 30000, max 120000).",
						),
				},
				async (args) => {
					const text = await executeRunCodeTool(args as RunCodeToolArgs);
					return {
						content: [{ type: "text" as const, text }],
					};
				},
			),
		],
	});
}
