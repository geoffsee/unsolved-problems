import { Agent, CursorAgentError, type SDKMessage } from "@cursor/sdk";
import { buildMcpServers } from "./cursorMcp";
import {
	createLogger,
	type Logger,
	summarizeContentBlocks,
	truncate,
} from "./logger";
import { buildCatalogPrompt, buildUserBrief } from "./prompt";
import {
	extractProblemIdFromUnknown,
	saveUsageArtifact,
} from "./usageArtifact";

const log = createLogger({ agent: "cursor" });

const MCP_URL =
	process.env.UNSOLVED_MCP_URL ||
	"https://unsolved-problems-api.seemueller.workers.dev/mcp";
const AGENT_ID =
	process.env.UNSOLVED_AGENT_ID || `cursor-agent-sdk-${Date.now()}`;
const MODEL = process.env.CURSOR_MODEL || "composer-2.5";
const LEASE_MINUTES = 60;
const PICK_MODE = process.env.UNSOLVED_PICK_MODE || "agent";
const SPECIFIC_PROBLEM_ID = process.env.UNSOLVED_PROBLEM_ID || null;
const USER_GOAL = process.env.UNSOLVED_USER_GOAL || "";
const USER_BACKGROUND = process.env.UNSOLVED_USER_BACKGROUND || "";
const USER_CONSTRAINTS = process.env.UNSOLVED_USER_CONSTRAINTS || "";
const USER_CONTEXT = process.env.UNSOLVED_USER_CONTEXT || "";
const API_KEY = process.env.CURSOR_API_KEY;
const CWD = process.env.CURSOR_CWD || process.cwd();

function buildPrompt() {
	return buildCatalogPrompt({
		agentId: AGENT_ID,
		leaseMinutes: LEASE_MINUTES,
		pickMode: PICK_MODE,
		specificProblemId: SPECIFIC_PROBLEM_ID,
		userBrief: buildUserBrief({
			goal: USER_GOAL,
			background: USER_BACKGROUND,
			constraints: USER_CONSTRAINTS,
			context: USER_CONTEXT,
		}),
		variant: "cursor",
	});
}

function logSdkMessage(logger: Logger, message: SDKMessage) {
	switch (message.type) {
		case "system": {
			logger.info("session initialized", {
				agentId: message.agent_id,
				runId: message.run_id,
				model: message.model,
				tools: message.tools,
			});
			return;
		}

		case "assistant": {
			logger.info("assistant turn", {
				agentId: message.agent_id,
				runId: message.run_id,
				content: summarizeContentBlocks(message.message.content),
			});
			return;
		}

		case "user": {
			logger.info("user message", {
				agentId: message.agent_id,
				runId: message.run_id,
				content: summarizeContentBlocks(message.message.content),
			});
			return;
		}

		case "tool_call": {
			const level =
				message.status === "error"
					? "error"
					: message.status === "running"
						? "info"
						: "info";
			const label =
				message.status === "running"
					? "tool starting"
					: message.status === "completed"
						? "tool finished"
						: "tool failed";

			logger[level](label, {
				agentId: message.agent_id,
				runId: message.run_id,
				callId: message.call_id,
				toolName: message.name,
				status: message.status,
				args: truncate(message.args),
				result: truncate(message.result),
			});
			return;
		}

		case "thinking": {
			logger.debug("thinking", {
				agentId: message.agent_id,
				runId: message.run_id,
				durationMs: message.thinking_duration_ms,
				text: truncate(message.text),
			});
			return;
		}

		case "status": {
			logger.info("run status", {
				agentId: message.agent_id,
				runId: message.run_id,
				status: message.status,
				message: message.message,
			});
			return;
		}

		case "task": {
			logger.debug("task update", {
				agentId: message.agent_id,
				runId: message.run_id,
				status: message.status,
				text: truncate(message.text),
			});
			return;
		}

		case "usage": {
			logger.info("token usage", {
				agentId: message.agent_id,
				runId: message.run_id,
				usage: message.usage,
			});
			return;
		}

		case "request": {
			logger.debug("request", {
				agentId: message.agent_id,
				runId: message.run_id,
				requestId: message.request_id,
			});
			return;
		}

		default: {
			logger.debug("sdk message", {
				payload: truncate(message),
			});
		}
	}
}

async function main() {
	if (!API_KEY) {
		throw new Error("CURSOR_API_KEY is required.");
	}

	const prompt = buildPrompt();
	const mcpServers = buildMcpServers({
		mcpUrl: MCP_URL,
		cwd: CWD,
	});

	log.info("starting cursor agent", {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		pickMode: PICK_MODE,
		problemId: SPECIFIC_PROBLEM_ID,
		userGoal: USER_GOAL || null,
		cwd: CWD,
		mcpServerNames: Object.keys(mcpServers),
		promptChars: prompt.length,
	});
	log.debug("agent prompt", { prompt: truncate(prompt) });

	await using agent = await Agent.create({
		apiKey: API_KEY,
		model: { id: MODEL },
		name: AGENT_ID,
		local: {
			cwd: CWD,
			// Inline MCP only — do not load ambient Cursor user/project settings.
			settingSources: [],
		},
		mcpServers,
	});

	const run = await agent.send(prompt);
	log.info("run started", {
		cursorAgentId: agent.agentId,
		runId: run.id,
	});

	let claimedProblemId: string | null = SPECIFIC_PROBLEM_ID;

	for await (const event of run.stream()) {
		logSdkMessage(log, event);

		if (event.type === "tool_call") {
			const fromArgs = extractProblemIdFromUnknown(event.args);
			if (fromArgs) {
				claimedProblemId = fromArgs;
			}
		}

		if (event.type === "assistant") {
			for (const block of event.message.content) {
				if (block.type === "tool_use") {
					const fromInput = extractProblemIdFromUnknown(block.input);
					if (fromInput) {
						claimedProblemId = fromInput;
					}
				}
			}
		}
	}

	const result = await run.wait();
	if (result.status === "error") {
		log.error("run failed", {
			cursorAgentId: agent.agentId,
			runId: result.id,
			status: result.status,
			error: result.error,
			durationMs: result.durationMs,
		});
		process.exitCode = 2;
		throw new Error(
			`Cursor agent run failed: ${result.error?.message ?? result.id}`,
		);
	}

	if (claimedProblemId && result.usage) {
		await saveUsageArtifact(log, {
			mcpUrl: MCP_URL,
			problemId: claimedProblemId,
			agentId: AGENT_ID,
			provider: "cursor",
			model: MODEL,
			totals: {
				inputTokens: result.usage.inputTokens,
				outputTokens: result.usage.outputTokens,
				cacheReadTokens: result.usage.cacheReadTokens,
				cacheWriteTokens: result.usage.cacheWriteTokens,
				totalTokens: result.usage.totalTokens,
				reasoningTokens: result.usage.reasoningTokens ?? null,
				durationMs: result.durationMs ?? null,
			},
			details: {
				cursorAgentId: agent.agentId,
				runId: result.id,
				usage: result.usage,
			},
		});
	} else {
		log.warn("skipping token usage artifact", {
			claimedProblemId,
			hasUsage: Boolean(result.usage),
		});
	}

	const summary = {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		cursorAgentId: agent.agentId,
		runId: result.id,
		pickMode: PICK_MODE,
		problemId: claimedProblemId,
		userGoal: USER_GOAL || null,
		status: result.status,
		durationMs: result.durationMs ?? null,
		usage: result.usage ?? null,
		result: result.result ?? null,
	};

	log.info("run complete", summary);
	console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		if (error instanceof CursorAgentError) {
			log.error("cursor agent startup failed", {
				err: error,
				retryable: error.isRetryable,
			});
			process.exitCode = 1;
		} else {
			log.error("cursor agent failed", { err: error });
			if (process.exitCode === undefined) {
				process.exitCode = 1;
			}
		}
		throw error;
	}
}
