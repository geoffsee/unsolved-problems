import { existsSync } from "node:fs";
import {
	type HookCallback,
	query,
	type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
	createLogger,
	type Logger,
	summarizeContentBlocks,
	truncate,
} from "./logger";

const log = createLogger({ agent: "anthropic" });

const MCP_URL =
	process.env.UNSOLVED_MCP_URL ||
	"https://unsolved-problems-api.seemueller.workers.dev/mcp";
const AGENT_ID =
	process.env.UNSOLVED_AGENT_ID || `claude-agent-sdk-${Date.now()}`;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
const LEASE_MINUTES = 60;
const PICK_MODE = process.env.UNSOLVED_PICK_MODE || "agent";
const SPECIFIC_PROBLEM_ID = process.env.UNSOLVED_PROBLEM_ID || null;
const USER_GOAL = process.env.UNSOLVED_USER_GOAL || "";
const USER_BACKGROUND = process.env.UNSOLVED_USER_BACKGROUND || "";
const USER_CONSTRAINTS = process.env.UNSOLVED_USER_CONSTRAINTS || "";
const USER_CONTEXT = process.env.UNSOLVED_USER_CONTEXT || "";

// A .mcp.json at the project root (cwd) is materialized from the MCP_CONFIG
// secret in CI. The Agent SDK only loads it when the "project" setting source
// is enabled, so opt in exactly when that file is present.
const HAS_PROJECT_MCP_CONFIG = existsSync(".mcp.json");

const MCP_SERVER = "unsolved";
const ALLOWED_MCP_TOOLS = [
	`mcp__${MCP_SERVER}__list_problems`,
	`mcp__${MCP_SERVER}__pick_problem`,
	`mcp__${MCP_SERVER}__save_progress`,
	`mcp__${MCP_SERVER}__list_claims`,
	// Research tooling comes from the servers in .mcp.json, not unsolved.
	"mcp__searxng",
	"mcp__fetch",
	"mcp__openalex",
	"mcp__crossref",
	"mcp__playwright",
];

function buildUserBrief() {
	const parts = [
		USER_GOAL ? `Desired outcome: ${USER_GOAL}` : null,
		USER_BACKGROUND ? `Background or strengths: ${USER_BACKGROUND}` : null,
		USER_CONSTRAINTS ? `Constraints or preferences: ${USER_CONSTRAINTS}` : null,
		USER_CONTEXT ? `Extra context: ${USER_CONTEXT}` : null,
	].filter((value): value is string => Boolean(value));

	return parts.join("\n");
}

function buildPickInstructions() {
	if (PICK_MODE === "specific") {
		if (!SPECIFIC_PROBLEM_ID) {
			throw new Error(
				"UNSOLVED_PROBLEM_ID is required when UNSOLVED_PICK_MODE=specific.",
			);
		}

		return [
			`Pick mode: specific.`,
			`Claim exactly this problemId: ${SPECIFIC_PROBLEM_ID}.`,
			"Do not choose a different problem.",
		].join("\n");
	}

	if (PICK_MODE === "random") {
		return [
			"Pick mode: random.",
			"Call list_problems with status=available and limit=25.",
			"Choose one of the returned problem IDs uniformly at random.",
			"Do not bias toward the first item.",
		].join("\n");
	}

	return [
		"Pick mode: agent.",
		"Call list_problems with status=available and limit=5.",
		"Choose the best candidate for a short first-pass research note.",
		"Prefer a concise statement and a clear scientific field.",
		"Use the user brief to bias selection when it is relevant.",
	].join("\n");
}

function buildPrompt() {
	const userBrief = buildUserBrief();

	return [
		`You are agent ${AGENT_ID} contributing to the Catalog of the Unsolved.`,
		"Use only the unsolved MCP tools for catalog work.",
		"",
		buildPickInstructions(),
		"",
		"Workflow:",
		`1. Select one available problem according to the pick instructions.`,
		`2. Call pick_problem with agentId=${AGENT_ID}, leaseMinutes=${LEASE_MINUTES}, and the chosen problemId.`,
		"3. Use the configured tools to find a credible primary source or authoritative review relevant to the problem.",
		"4. Call save_progress exactly once with a durable research contribution, not a generic plan or status report:",
		"   - choose the most accurate kind (reference, hypothesis, failed_attempt, candidate_approach, or note)",
		"   - use a specific title that says what was learned or proposed",
		"   - in content, state a concrete claim or result, its supporting basis, the main limitation, and the next discriminating test",
		"   - put the exact best source URL you found in artifactUrl; if no credible source was found, say so explicitly and do not use kind=reference",
		"   - do not claim the open problem is solved",
		"5. Stop after saving progress. Do not call submit_solution or release_problem.",
		"",
		userBrief ? `User brief:\n${userBrief}` : "User brief: none supplied.",
		"",
		"When finished, reply with a compact plain-text summary including problemId, claim outcome, and whether save_progress succeeded.",
	].join("\n");
}

function logSdkMessage(logger: Logger, message: SDKMessage) {
	switch (message.type) {
		case "system": {
			if (message.subtype === "init") {
				logger.info("session initialized", {
					sessionId: message.session_id,
					model: message.model,
					cwd: message.cwd,
					permissionMode: message.permissionMode,
					tools: message.tools,
					mcpServers: message.mcp_servers,
					claudeCodeVersion: message.claude_code_version,
					apiKeySource: message.apiKeySource,
				});
				return;
			}

			if (message.subtype === "api_retry") {
				logger.warn("api retry", {
					attempt: message.attempt,
					maxRetries: message.max_retries,
					retryDelayMs: message.retry_delay_ms,
					errorStatus: message.error_status,
					error: message.error,
				});
				return;
			}

			logger.debug("system event", {
				subtype: message.subtype,
				payload: truncate(message),
			});
			return;
		}

		case "assistant": {
			logger.info("assistant turn", {
				sessionId: message.session_id,
				parentToolUseId: message.parent_tool_use_id,
				error: message.error,
				stopReason: message.message.stop_reason,
				usage: message.message.usage,
				content: summarizeContentBlocks(message.message.content),
			});
			return;
		}

		case "user": {
			const content =
				message.message &&
				typeof message.message === "object" &&
				"content" in message.message
					? message.message.content
					: message.message;

			logger.info("user / tool result", {
				sessionId: message.session_id,
				parentToolUseId: message.parent_tool_use_id,
				isSynthetic: message.isSynthetic,
				toolUseResult: truncate(message.tool_use_result),
				content: summarizeContentBlocks(content),
			});
			return;
		}

		case "tool_progress": {
			logger.debug("tool progress", {
				toolUseId: message.tool_use_id,
				toolName: message.tool_name,
				elapsedSeconds: message.elapsed_time_seconds,
				parentToolUseId: message.parent_tool_use_id,
			});
			return;
		}

		case "tool_use_summary": {
			logger.info("tool use summary", {
				summary: truncate(message.summary),
				toolUseIds: message.preceding_tool_use_ids,
			});
			return;
		}

		case "result": {
			if (message.subtype === "success") {
				logger.info("agent finished successfully", {
					sessionId: message.session_id,
					numTurns: message.num_turns,
					durationMs: message.duration_ms,
					durationApiMs: message.duration_api_ms,
					totalCostUsd: message.total_cost_usd,
					usage: message.usage,
					stopReason: message.stop_reason,
					permissionDenials: message.permission_denials,
					result: truncate(message.result),
				});
			} else {
				logger.error("agent finished with error", {
					sessionId: message.session_id,
					subtype: message.subtype,
					numTurns: message.num_turns,
					durationMs: message.duration_ms,
					totalCostUsd: message.total_cost_usd,
					errors: message.errors,
					permissionDenials: message.permission_denials,
				});
			}
			return;
		}

		default: {
			logger.debug("sdk message", {
				type: message.type,
				payload: truncate(message),
			});
		}
	}
}

function buildLoggingHooks(logger: Logger) {
	const logPreToolUse: HookCallback = async (input) => {
		if (input.hook_event_name !== "PreToolUse") {
			return { continue: true };
		}

		logger.info("tool starting", {
			toolUseId: input.tool_use_id,
			toolName: input.tool_name,
			input: truncate(input.tool_input),
		});
		return { continue: true };
	};

	const logPostToolUse: HookCallback = async (input) => {
		if (input.hook_event_name !== "PostToolUse") {
			return { continue: true };
		}

		logger.info("tool finished", {
			toolUseId: input.tool_use_id,
			toolName: input.tool_name,
			durationMs: input.duration_ms,
			input: truncate(input.tool_input),
			response: truncate(input.tool_response),
		});
		return { continue: true };
	};

	const logPostToolUseFailure: HookCallback = async (input) => {
		if (input.hook_event_name !== "PostToolUseFailure") {
			return { continue: true };
		}

		logger.error("tool failed", {
			toolUseId: input.tool_use_id,
			toolName: input.tool_name,
			durationMs: input.duration_ms,
			isInterrupt: input.is_interrupt,
			input: truncate(input.tool_input),
			error: input.error,
		});
		return { continue: true };
	};

	return {
		PreToolUse: [{ hooks: [logPreToolUse] }],
		PostToolUse: [{ hooks: [logPostToolUse] }],
		PostToolUseFailure: [{ hooks: [logPostToolUseFailure] }],
	};
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		throw new Error("ANTHROPIC_API_KEY is required.");
	}

	const prompt = buildPrompt();

	log.info("starting anthropic agent", {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		pickMode: PICK_MODE,
		problemId: SPECIFIC_PROBLEM_ID,
		userGoal: USER_GOAL || null,
		hasProjectMcpConfig: HAS_PROJECT_MCP_CONFIG,
		allowedTools: ALLOWED_MCP_TOOLS,
		promptChars: prompt.length,
	});
	log.debug("agent prompt", { prompt: truncate(prompt) });

	let finalResult: string | null = null;
	let sessionId: string | null = null;

	for await (const message of query({
		prompt,
		options: {
			model: MODEL,
			systemPrompt:
				"You are a careful research agent. Publish source-preserving, concrete research contributions rather than generic progress notes. Be skeptical and use MCP tools to claim work and save progress.",
			mcpServers: {
				[MCP_SERVER]: {
					type: "http",
					url: MCP_URL,
					headers: {
						Accept: "application/json, text/event-stream",
					},
				},
			},
			allowedTools: ALLOWED_MCP_TOOLS,
			disallowedTools: [
				"Bash",
				"Write",
				"Edit",
				"Read",
				"Glob",
				"Grep",
				"WebSearch",
				"WebFetch",
				"Agent",
				"Skill",
			],
			permissionMode: "dontAsk",
			maxTurns: 16,
			settingSources: HAS_PROJECT_MCP_CONFIG ? ["project"] : [],
			hooks: buildLoggingHooks(log),
		},
	})) {
		logSdkMessage(log, message);

		if (message.type === "system" && message.subtype === "init") {
			sessionId = message.session_id;
		}

		if (message.type === "result") {
			if (message.subtype === "success") {
				finalResult = message.result;
			} else {
				const detail = message.errors?.length
					? message.errors.join("; ")
					: message.subtype;
				throw new Error(`Claude agent finished unsuccessfully: ${detail}`);
			}
		}
	}

	const summary = {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		pickMode: PICK_MODE,
		problemId: SPECIFIC_PROBLEM_ID,
		userGoal: USER_GOAL || null,
		sessionId,
		result: finalResult,
	};

	log.info("run complete", summary);
	console.log(JSON.stringify(summary, null, 2));
}

try {
	await main();
} catch (error) {
	log.error("anthropic agent failed", { err: error });
	throw error;
}
