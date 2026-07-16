export const SANDBOX_MCP_SERVER_NAME = "code_sandbox";
export const RUN_CODE_TOOL_NAME = "run_code";

export const ANTHROPIC_SANDBOX_ALLOWED_TOOLS = [
	`mcp__${SANDBOX_MCP_SERVER_NAME}__${RUN_CODE_TOOL_NAME}`,
] as const;
