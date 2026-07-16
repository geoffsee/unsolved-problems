import { existsSync } from "node:fs";
import {
	type HookCallback,
	query,
	type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
	createLogger,
	type Logger,
	summarizeAssistantActivity,
	summarizeToolArgs,
	summarizeToolOutcome,
	truncate,
} from "./logger";
import { buildCatalogPrompt, buildUserBrief } from "./prompt";
import { resolveRuntimePick } from "./resolvePick";
import {
	extractProblemIdFromUnknown,
	saveUsageArtifact,
} from "./usageArtifact";

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
export const ALLOWED_MCP_TOOLS = [
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

function buildPrompt(input: {
	pickMode: string;
	specificProblemId?: string | null;
}) {
	return buildCatalogPrompt({
		agentId: AGENT_ID,
		leaseMinutes: LEASE_MINUTES,
		pickMode: input.pickMode,
		specificProblemId: input.specificProblemId,
		userBrief: buildUserBrief({
			goal: USER_GOAL,
			background: USER_BACKGROUND,
			constraints: USER_CONSTRAINTS,
			context: USER_CONTEXT,
		}),
		variant: "anthropic",
	});
}

function logSdkMessage(logger: Logger, message: SDKMessage) {
	switch (message.type) {
		case "system": {
			if (message.subtype === "init") {
				logger.info("session initialized", {
					model: message.model,
				});
				return;
			}

			if (message.subtype === "api_retry") {
				logger.warn("api retry", {
					attempt: message.attempt,
					maxRetries: message.max_retries,
					retryDelayMs: message.retry_delay_ms,
					errorStatus: message.error_status,
				});
				return;
			}

			logger.debug("system event", { subtype: message.subtype });
			return;
		}

		case "assistant": {
			const activity = summarizeAssistantActivity(message.message.content);
			// Tool calls are logged by PreToolUse hooks; only surface model text here.
			if (!activity.text) {
				logger.debug("assistant turn", {
					tools: activity.tools,
					thinking: activity.thinking,
					stopReason: message.message.stop_reason,
				});
				return;
			}

			logger.info("model", {
				text: activity.text,
				tools: activity.tools,
			});
			return;
		}

		case "user": {
			logger.debug("tool result delivered");
			return;
		}

		case "tool_progress": {
			logger.debug("tool progress", {
				toolName: message.tool_name,
				elapsedSeconds: message.elapsed_time_seconds,
			});
			return;
		}

		case "tool_use_summary": {
			logger.debug("tool use summary", {
				summary: truncate(message.summary, 160),
			});
			return;
		}

		case "result": {
			if (message.subtype === "success") {
				logger.info("agent finished successfully", {
					numTurns: message.num_turns,
					durationMs: message.duration_ms,
					totalCostUsd: message.total_cost_usd,
					result: truncate(message.result, 320),
				});
			} else {
				logger.error("agent finished with error", {
					subtype: message.subtype,
					numTurns: message.num_turns,
					durationMs: message.duration_ms,
					errors: message.errors,
				});
			}
			return;
		}

		default: {
			logger.debug("sdk message", { type: message.type });
		}
	}
}

function buildLoggingHooks(logger: Logger) {
	const logPreToolUse: HookCallback = async (input) => {
		if (input.hook_event_name !== "PreToolUse") {
			return { continue: true };
		}

		logger.info("tool starting", {
			toolName: input.tool_name,
			args: summarizeToolArgs(input.tool_input),
		});
		return { continue: true };
	};

	const logPostToolUse: HookCallback = async (input) => {
		if (input.hook_event_name !== "PostToolUse") {
			return { continue: true };
		}

		logger.info("tool finished", {
			toolName: input.tool_name,
			durationMs: input.duration_ms,
			outcome: summarizeToolOutcome(input.tool_response),
		});
		return { continue: true };
	};

	const logPostToolUseFailure: HookCallback = async (input) => {
		if (input.hook_event_name !== "PostToolUseFailure") {
			return { continue: true };
		}

		logger.error("tool failed", {
			toolName: input.tool_name,
			durationMs: input.duration_ms,
			args: summarizeToolArgs(input.tool_input),
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

	const resolvedPick = await resolveRuntimePick({
		pickMode: PICK_MODE,
		specificProblemId: SPECIFIC_PROBLEM_ID,
		mcpUrl: MCP_URL,
		limit: 100,
	});
	const prompt = buildPrompt(resolvedPick);

	log.info("starting anthropic agent", {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		pickMode: PICK_MODE,
		problemId: resolvedPick.specificProblemId,
		category: resolvedPick.category ?? null,
		poolSize: resolvedPick.poolSize ?? null,
		userGoal: USER_GOAL || null,
	});
	log.debug("agent prompt", { promptChars: prompt.length });

	let finalResult: string | null = null;
	let claimedProblemId: string | null = resolvedPick.specificProblemId;
	let usage: Record<string, unknown> | null = null;
	let modelUsage: Record<string, unknown> | null = null;
	let totalCostUsd: number | null = null;
	let numTurns: number | null = null;

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
						...(process.env.UNSOLVED_API_TOKEN
							? {
									Authorization: `Bearer ${process.env.UNSOLVED_API_TOKEN}`,
								}
							: {}),
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

		if (message.type === "assistant") {
			for (const block of message.message.content) {
				if (
					block &&
					typeof block === "object" &&
					"type" in block &&
					block.type === "tool_use" &&
					"input" in block
				) {
					const problemId = extractProblemIdFromUnknown(block.input);
					if (problemId) {
						claimedProblemId = problemId;
					}
				}
			}
		}

		if (message.type === "result") {
			if (message.subtype === "success") {
				finalResult = message.result;
				usage = message.usage as unknown as Record<string, unknown>;
				modelUsage = message.modelUsage as unknown as Record<string, unknown>;
				totalCostUsd = message.total_cost_usd;
				numTurns = message.num_turns;
			} else {
				const detail = message.errors?.length
					? message.errors.join("; ")
					: message.subtype;
				throw new Error(`Claude agent finished unsuccessfully: ${detail}`);
			}
		}
	}

	if (claimedProblemId && usage) {
		await saveUsageArtifact(log, {
			mcpUrl: MCP_URL,
			problemId: claimedProblemId,
			agentId: AGENT_ID,
			provider: "anthropic",
			model: MODEL,
			totals: {
				numTurns,
				totalCostUsd,
				inputTokens: usage.input_tokens as number | undefined,
				outputTokens: usage.output_tokens as number | undefined,
				cacheReadTokens: usage.cache_read_input_tokens as number | undefined,
				cacheCreationTokens: usage.cache_creation_input_tokens as
					| number
					| undefined,
			},
			details: {
				usage,
				modelUsage,
			},
		});
	} else {
		log.warn("skipping token usage artifact", {
			claimedProblemId,
			hasUsage: Boolean(usage),
		});
	}

	const summary = {
		model: MODEL,
		agentId: AGENT_ID,
		pickMode: PICK_MODE,
		problemId: claimedProblemId,
		totalCostUsd,
		numTurns,
		result: finalResult,
	};

	log.info("run complete", {
		...summary,
		result: truncate(finalResult, 320),
	});
	console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		log.error("anthropic agent failed", { err: error });
		throw error;
	}
}
