import { Agent, MCPServerStreamableHttp, run } from "@openai/agents";
import { createLogger, truncate, withToolLogging } from "./logger";
import {
	getText,
	parseCandidateIds,
	ResearchCheckpointSchema,
	resolveChosenProblemId,
	SelectionSchema,
} from "./openaiHelpers";
import { buildUserBrief } from "./prompt";
import { saveUsageArtifact } from "./usageArtifact";

const log = createLogger({ agent: "openai" });

const MCP_URL =
	process.env.UNSOLVED_MCP_URL ||
	"https://unsolved-problems-api.seemueller.workers.dev/mcp";
const AGENT_ID =
	process.env.UNSOLVED_AGENT_ID || `openai-agents-sdk-${Date.now()}`;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const MODEL_SETTINGS = {
	reasoning: { effort: "low" as const },
};
const LEASE_MINUTES = 60;
const PICK_MODE = process.env.UNSOLVED_PICK_MODE || "random";
const SPECIFIC_PROBLEM_ID = process.env.UNSOLVED_PROBLEM_ID || null;
const USER_GOAL = process.env.UNSOLVED_USER_GOAL || "";
const USER_BACKGROUND = process.env.UNSOLVED_USER_BACKGROUND || "";
const USER_CONSTRAINTS = process.env.UNSOLVED_USER_CONSTRAINTS || "";
const USER_CONTEXT = process.env.UNSOLVED_USER_CONTEXT || "";

type ProblemClaim = {
	claimId: string;
	problemId: string;
	agentId: string;
	status: string;
};

type ResearchEntry = {
	entryId: string;
	agentId: string;
	kind: string;
	title: string | null;
	content: string;
	createdAt: string;
};

type ProblemResource = {
	id: string;
	category: string;
	section: string;
	text: string;
	researchEntries?: ResearchEntry[];
};

async function listAvailableProblemIds(
	mcpServer: MCPServerStreamableHttp,
	limit: number,
) {
	const args = { limit, status: "available" };
	const listResult = await withToolLogging(log, "list_problems", args, () =>
		mcpServer.callTool("list_problems", args),
	);
	const candidatesText = getText(listResult);
	const candidateIds = parseCandidateIds(candidatesText);
	log.info("listed available problems", {
		limit,
		candidateCount: candidateIds.length,
		candidateIds,
		candidatesText: truncate(candidatesText),
	});
	return { candidatesText, candidateIds };
}

async function chooseProblemId(mcpServer: MCPServerStreamableHttp) {
	const userBrief = buildUserBrief({
		goal: USER_GOAL,
		background: USER_BACKGROUND,
		constraints: USER_CONSTRAINTS,
		context: USER_CONTEXT,
	});

	if (PICK_MODE === "specific") {
		const chosen = resolveChosenProblemId({
			pickMode: PICK_MODE,
			specificProblemId: SPECIFIC_PROBLEM_ID,
			candidateIds: [],
		});
		log.info("using specific problem", { problemId: chosen.chosenProblemId });
		return { ...chosen, usage: null };
	}

	const { candidatesText, candidateIds } = await listAvailableProblemIds(
		mcpServer,
		PICK_MODE === "random" ? 100 : 5,
	);

	if (PICK_MODE === "random") {
		const chosen = resolveChosenProblemId({
			pickMode: PICK_MODE,
			specificProblemId: SPECIFIC_PROBLEM_ID,
			candidateIds,
		});
		log.info("selected random problem", {
			problemId: chosen.chosenProblemId,
			poolSize: candidateIds.length,
		});
		return { ...chosen, usage: null };
	}

	if (candidateIds.length === 0) {
		throw new Error("The MCP server did not return any available problem IDs.");
	}

	log.info("running problem selector agent", {
		candidateCount: candidateIds.length,
		userBrief: truncate(userBrief || null),
	});

	const selector = new Agent({
		name: "Problem Selector",
		model: MODEL,
		modelSettings: MODEL_SETTINGS,
		outputType: SelectionSchema,
		instructions: [
			"Choose one unsolved problem to work on from the supplied candidates.",
			"Use the user's brief to bias your selection when it is relevant.",
			"Prefer a problem with a concise statement and a clear scientific field.",
			"Return exactly one candidate problemId and a short reason.",
		].join("\n"),
	});

	const selection = await run(
		selector,
		[
			"Select one of these available problem candidates.",
			"",
			candidatesText,
			"",
			userBrief ? `User brief:\n${userBrief}\n` : "",
			`Valid problem IDs: ${candidateIds.join(", ")}`,
		].join("\n"),
	);

	if (!selection.finalOutput) {
		throw new Error("The selector agent did not return a problem choice.");
	}

	const chosenProblemId = selection.finalOutput.problemId;
	if (!candidateIds.includes(chosenProblemId)) {
		throw new Error(`Agent selected an invalid problemId: ${chosenProblemId}`);
	}

	log.info("selector chose problem", {
		problemId: chosenProblemId,
		reason: selection.finalOutput.reason,
	});

	return {
		chosenProblemId,
		reason: selection.finalOutput.reason,
		usage: selection.state.usage,
	};
}

async function main() {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is required.");
	}

	log.info("starting openai agent", {
		mcpUrl: MCP_URL,
		model: MODEL,
		agentId: AGENT_ID,
		pickMode: PICK_MODE,
		problemId: SPECIFIC_PROBLEM_ID,
		userGoal: USER_GOAL || null,
	});

	const mcpServer = new MCPServerStreamableHttp({
		name: "unsolved-problems",
		url: MCP_URL,
		cacheToolsList: true,
	});

	log.info("connecting to mcp server", { mcpUrl: MCP_URL });
	await mcpServer.connect();
	log.info("mcp server connected");

	try {
		const userBrief = buildUserBrief({
			goal: USER_GOAL,
			background: USER_BACKGROUND,
			constraints: USER_CONSTRAINTS,
			context: USER_CONTEXT,
		});
		const {
			chosenProblemId,
			reason,
			usage: selectorUsage,
		} = await chooseProblemId(mcpServer);

		const pickArgs = {
			agentId: AGENT_ID,
			problemId: chosenProblemId,
			leaseMinutes: LEASE_MINUTES,
		};
		await withToolLogging(log, "pick_problem", pickArgs, () =>
			mcpServer.callTool("pick_problem", pickArgs),
		);

		log.info("reading queue resource");
		const queueResource = await mcpServer.readResource("unsolved://queue");
		const queueJson = queueResource.contents.find(
			(item) => "text" in item,
		)?.text;
		if (!queueJson) {
			throw new Error("Queue resource did not return JSON text.");
		}

		const queue = JSON.parse(String(queueJson)) as {
			activeClaims: ProblemClaim[];
		};

		const claim = queue.activeClaims.find(
			(entry) =>
				entry.agentId === AGENT_ID &&
				entry.problemId === chosenProblemId &&
				entry.status === "active",
		);

		if (!claim) {
			throw new Error(
				`Claim for ${chosenProblemId} was not found in the queue resource.`,
			);
		}

		log.info("claim confirmed", {
			claimId: claim.claimId,
			problemId: claim.problemId,
			status: claim.status,
		});

		log.info("reading problem resource", { problemId: chosenProblemId });
		const problemResource = await mcpServer.readResource(
			`unsolved://problem/${chosenProblemId}`,
		);
		const problemJson = problemResource.contents.find(
			(item) => "text" in item,
		)?.text;
		if (!problemJson) {
			throw new Error(
				`Problem resource for ${chosenProblemId} did not return JSON text.`,
			);
		}

		const problem = JSON.parse(String(problemJson)) as ProblemResource;
		const priorResearch = (problem.researchEntries ?? [])
			.slice(-3)
			.map(
				(entry, index) =>
					`${index + 1}. [${entry.kind}] ${entry.title ?? "Untitled"} by ${entry.agentId}: ${entry.content}`,
			)
			.join("\n");

		log.info("starting research kickoff agent", {
			problemId: problem.id,
			category: problem.category,
			section: problem.section,
			priorResearchCount: problem.researchEntries?.length ?? 0,
			problem: truncate(problem.text),
			userBrief: truncate(userBrief || null),
		});

		const researcher = new Agent({
			name: "Research Kickoff",
			model: MODEL,
			modelSettings: MODEL_SETTINGS,
			mcpServers: [mcpServer],
			outputType: ResearchCheckpointSchema,
			instructions: [
				"You are starting work on a newly claimed unsolved problem.",
				"Follow the user's brief where it helps produce a better first pass.",
				"Read any prior shared research before proposing the next step.",
				"Use the search_web MCP tool to find a credible primary source or authoritative review before writing the update.",
				"Produce a durable research contribution, not a generic plan or status report.",
				"The content must state: (1) a concrete claim or result, (2) what supports it, (3) the main limitation or uncertainty, and (4) the next discriminating test or calculation.",
				"Choose the most accurate contribution kind. Use reference only when sourceUrl contains the referenced source.",
				"Preserve the exact best source URL in sourceUrl. Use null only when the search returned no credible source, and say that explicitly in content.",
				"Do not overclaim that a hard open problem is solved.",
				"Keep the title specific and the content concise, skeptical, and understandable without the search transcript.",
			].join("\n"),
		});

		const kickoff = await run(
			researcher,
			[
				`Problem: ${problem.text}`,
				`Field: ${problem.category} / ${problem.section}`,
				userBrief ? `User brief:\n${userBrief}` : "User brief: none supplied.",
				priorResearch
					? `Recent shared research:\n${priorResearch}`
					: "Recent shared research: none yet.",
				"Write one useful, source-preserving research update for the shared log.",
			].join("\n"),
		);

		const checkpoint = kickoff.finalOutput;
		log.info("research kickoff complete", {
			checkpoint: truncate(checkpoint),
		});

		if (checkpoint?.content.trim()) {
			const saveArgs = {
				problemId: chosenProblemId,
				agentId: AGENT_ID,
				kind: checkpoint.kind,
				title: checkpoint.title.trim(),
				content: checkpoint.content.trim(),
				...(checkpoint.sourceUrl ? { artifactUrl: checkpoint.sourceUrl } : {}),
			};
			await withToolLogging(log, "save_progress", saveArgs, () =>
				mcpServer.callTool("save_progress", saveArgs),
			);
		} else {
			log.warn("skipping save_progress; empty research checkpoint");
		}

		const researchUsage = kickoff.state.usage;
		const usageTotals = {
			requests: (selectorUsage?.requests ?? 0) + (researchUsage.requests ?? 0),
			inputTokens:
				(selectorUsage?.inputTokens ?? 0) + (researchUsage.inputTokens ?? 0),
			outputTokens:
				(selectorUsage?.outputTokens ?? 0) + (researchUsage.outputTokens ?? 0),
			totalTokens:
				(selectorUsage?.totalTokens ?? 0) + (researchUsage.totalTokens ?? 0),
		};

		await saveUsageArtifact(log, {
			mcpUrl: MCP_URL,
			problemId: chosenProblemId,
			agentId: AGENT_ID,
			provider: "openai",
			model: MODEL,
			totals: usageTotals,
			details: {
				selector: selectorUsage
					? {
							requests: selectorUsage.requests,
							inputTokens: selectorUsage.inputTokens,
							outputTokens: selectorUsage.outputTokens,
							totalTokens: selectorUsage.totalTokens,
						}
					: null,
				research: {
					requests: researchUsage.requests,
					inputTokens: researchUsage.inputTokens,
					outputTokens: researchUsage.outputTokens,
					totalTokens: researchUsage.totalTokens,
					inputTokensDetails: researchUsage.inputTokensDetails,
					outputTokensDetails: researchUsage.outputTokensDetails,
				},
			},
			callTool: (name, args) => mcpServer.callTool(name, args),
		});

		const summary = {
			mcpUrl: MCP_URL,
			model: MODEL,
			agentId: AGENT_ID,
			claimId: claim.claimId,
			problemId: problem.id,
			category: problem.category,
			section: problem.section,
			problem: problem.text,
			reason,
			pickMode: PICK_MODE,
			userGoal: USER_GOAL || null,
			priorResearchCount: problem.researchEntries?.length ?? 0,
			researchUpdate: checkpoint ?? null,
			usage: usageTotals,
		};

		log.info("run complete", summary);
		console.log(JSON.stringify(summary, null, 2));
	} finally {
		log.info("closing mcp server");
		await mcpServer.close();
	}
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		log.error("openai agent failed", { err: error });
		throw error;
	}
}
