import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	Agent,
	CursorAgentError,
	type McpServerConfig,
	type SDKMessage,
} from "@cursor/sdk";
import {
	createLogger,
	type Logger,
	summarizeContentBlocks,
	truncate,
} from "./logger";

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
		"Use the unsolved MCP tools for catalog work.",
		"Prefer the configured research MCP tools (searxng, fetch, openalex, crossref, playwright) over editing local files.",
		"Do not modify repository source files. Do not open a PR.",
		"",
		buildPickInstructions(),
		"",
		"Workflow:",
		`1. Select one available problem according to the pick instructions.`,
		`2. Call pick_problem with agentId=${AGENT_ID}, leaseMinutes=${LEASE_MINUTES}, and the chosen problemId.`,
		"3. Use the configured research tools to find a credible primary source or authoritative review relevant to the problem.",
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

function resolveEnvValue(raw: string): string {
	return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
		return process.env[name] ?? "";
	});
}

function loadResearchMcpServers(): Record<string, McpServerConfig> {
	const mcpPath = join(CWD, ".mcp.json");
	if (!existsSync(mcpPath)) {
		return {};
	}

	const parsed = JSON.parse(readFileSync(mcpPath, "utf8")) as {
		mcpServers?: Record<
			string,
			{
				command?: string;
				args?: string[];
				env?: Record<string, string>;
				cwd?: string;
				url?: string;
				type?: string;
				headers?: Record<string, string>;
			}
		>;
	};

	const servers: Record<string, McpServerConfig> = {};
	for (const [name, config] of Object.entries(parsed.mcpServers ?? {})) {
		if (config.url) {
			servers[name] = {
				type: config.type === "sse" ? "sse" : "http",
				url: resolveEnvValue(config.url),
				...(config.headers
					? {
							headers: Object.fromEntries(
								Object.entries(config.headers).map(([key, value]) => [
									key,
									resolveEnvValue(value),
								]),
							),
						}
					: {}),
			};
			continue;
		}

		if (!config.command) {
			continue;
		}

		servers[name] = {
			type: "stdio",
			command: config.command,
			args: config.args,
			cwd: config.cwd ? resolveEnvValue(config.cwd) : CWD,
			...(config.env
				? {
						env: Object.fromEntries(
							Object.entries(config.env).map(([key, value]) => [
								key,
								resolveEnvValue(value),
							]),
						),
					}
				: {}),
		};
	}

	return servers;
}

function buildMcpServers(): Record<string, McpServerConfig> {
	return {
		unsolved: {
			type: "http",
			url: MCP_URL,
			headers: {
				Accept: "application/json, text/event-stream",
			},
		},
		...loadResearchMcpServers(),
	};
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
				truncated: message.truncated,
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
	const mcpServers = buildMcpServers();

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

	for await (const event of run.stream()) {
		logSdkMessage(log, event);
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

	const summary = {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		cursorAgentId: agent.agentId,
		runId: result.id,
		pickMode: PICK_MODE,
		problemId: SPECIFIC_PROBLEM_ID,
		userGoal: USER_GOAL || null,
		status: result.status,
		durationMs: result.durationMs ?? null,
		usage: result.usage ?? null,
		result: result.result ?? null,
	};

	log.info("run complete", summary);
	console.log(JSON.stringify(summary, null, 2));
}

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
