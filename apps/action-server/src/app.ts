import { resolve } from "node:path";
import { Hono } from "hono";
import type { RunDatabase } from "./database";
import { actionEnvironment, invokeLocalAction } from "./runner";
import type {
	ActionOptions,
	RunRequest,
	ServerConfig,
	Workflow,
} from "./types";
import { discoverWorkflows, localActionSteps } from "./workflows";

interface AppOptions {
	root: string;
	database: RunDatabase;
	config: ServerConfig;
	token?: string;
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function optionsFor(
	path: string,
	stepId: string | undefined,
	config: ServerConfig,
	request: RunRequest,
): ActionOptions {
	return {
		...(config.actions?.[path] ?? {}),
		...(stepId ? request.actions?.[stepId] : {}),
		...(request.actions?.[path] ?? {}),
	};
}

export function createApp(options: AppOptions) {
	const app = new Hono();

	app.use("*", async (context, next) => {
		if (!options.token || context.req.path === "/health") return next();
		if (context.req.header("authorization") !== `Bearer ${options.token}`) {
			return context.json({ error: "Unauthorized" }, 401);
		}
		return next();
	});

	app.get("/health", (context) => context.json({ ok: true }));

	app.get("/workflows", async (context) => {
		const workflows = await discoverWorkflows(options.root);
		return context.json(
			workflows.map((workflow) => ({
				id: workflow.id,
				name: workflow.name,
				path: workflow.path,
				crons: workflow.crons,
				localActions: localActionSteps(workflow).map(({ jobId, step }) => ({
					job: jobId,
					step: step.id,
					name: step.name,
					path: step.uses,
				})),
				unsupported: Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
					job.steps
						.filter((step) => !step.uses?.startsWith("./"))
						.map((step) => ({
							job: jobId,
							step: step.id,
							name: step.name,
							type: step.run ? "run" : "remote-action",
						})),
				),
			})),
		);
	});

	app.get("/runs", async (context) => {
		const requested = Number(context.req.query("limit") ?? 50);
		const limit = Number.isInteger(requested)
			? Math.min(Math.max(requested, 1), 200)
			: 50;
		return context.json(await options.database.list(limit));
	});

	app.get("/runs/:id", async (context) => {
		const run = await options.database.get(context.req.param("id"));
		return run
			? context.json(run)
			: context.json({ error: "Run not found" }, 404);
	});

	async function startAction(args: {
		actionPath: string;
		workflow: string | null;
		trigger: string;
		actionOptions: ActionOptions;
		env: Record<string, string>;
	}) {
		const id = crypto.randomUUID();
		await options.database.create({
			id,
			workflow: args.workflow,
			action_path: args.actionPath,
			trigger: args.trigger,
			status: "running",
			created_at: new Date().toISOString(),
		});
		void invokeLocalAction(options.root, {
			actionPath: args.actionPath,
			...args.actionOptions,
			env: args.env,
		})
			.then(({ exitCode, log }) => options.database.finish(id, exitCode, log))
			.catch((error) => options.database.finish(id, 1, errorMessage(error)));
		return id;
	}

	async function runWorkflow(
		workflow: Workflow,
		request: RunRequest,
		trigger: string,
	) {
		const ids: string[] = [];
		for (const { jobId, step } of localActionSteps(workflow)) {
			const actionPath = step.uses as string;
			const actionOptions = optionsFor(
				actionPath,
				`${jobId}.${step.id}`,
				options.config,
				request,
			);
			if (!actionOptions.entrypoint) {
				for (const candidate of ["src/main.ts", "src/main.js"]) {
					if (
						await Bun.file(
							resolve(options.root, actionPath, candidate),
						).exists()
					) {
						actionOptions.entrypoint = candidate;
						break;
					}
				}
			}
			ids.push(
				await startAction({
					actionPath,
					workflow: workflow.id,
					trigger,
					actionOptions,
					env: actionEnvironment(options.root, step, {
						GITHUB_EVENT_NAME:
							trigger === "schedule" ? "schedule" : "workflow_dispatch",
						...(request.env ?? {}),
					}),
				}),
			);
		}
		return ids;
	}

	app.post("/actions/run", async (context) => {
		try {
			const body = await context.req.json<{
				path?: string;
				entrypoint?: string;
				dotenv?: string;
				pre?: string;
				post?: string;
				env?: Record<string, string>;
			}>();
			if (!body.path || !body.entrypoint || !body.dotenv) {
				return context.json(
					{ error: "path, entrypoint, and dotenv are required" },
					400,
				);
			}
			const id = await startAction({
				actionPath: body.path,
				workflow: null,
				trigger: "api",
				actionOptions: body,
				env: body.env ?? {},
			});
			return context.json({ id, status: "running" }, 202);
		} catch (error) {
			return context.json({ error: errorMessage(error) }, 400);
		}
	});

	app.post("/workflows/:id/run", async (context) => {
		try {
			const workflow = (await discoverWorkflows(options.root)).find(
				(item) => item.id === context.req.param("id"),
			);
			if (!workflow) return context.json({ error: "Workflow not found" }, 404);
			const request = await context.req
				.json<RunRequest>()
				.catch(() => ({}) as RunRequest);
			const localSteps = localActionSteps(workflow);
			if (localSteps.length === 0) {
				return context.json(
					{
						error: "Workflow has no local action steps",
						detail:
							"local-action only runs uses: ./... JavaScript/TypeScript actions",
					},
					422,
				);
			}
			const ids = await runWorkflow(workflow, request, "api");
			return context.json({ runs: ids }, 202);
		} catch (error) {
			return context.json({ error: errorMessage(error) }, 400);
		}
	});

	return { app, runWorkflow };
}

export async function readConfig(root: string): Promise<ServerConfig> {
	for (const name of [".github/local-action.json", ".local-action.json"]) {
		const path = resolve(root, name);
		if (await Bun.file(path).exists()) return Bun.file(path).json();
	}
	return {};
}
