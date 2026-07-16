import { readdir } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import type { Workflow, WorkflowJob, WorkflowStep } from "./types";

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as ObjectValue)
		: {};
}

function normalizeStep(value: unknown, index: number): WorkflowStep {
	const step = object(value);
	return {
		id: typeof step.id === "string" ? step.id : String(index + 1),
		name:
			typeof step.name === "string"
				? step.name
				: typeof step.uses === "string"
					? step.uses
					: `step-${index + 1}`,
		uses: typeof step.uses === "string" ? step.uses : undefined,
		run: typeof step.run === "string" ? step.run : undefined,
		with: object(step.with),
		env: object(step.env),
	};
}

export async function readWorkflow(path: string): Promise<Workflow> {
	const source = Bun.YAML.parse(await Bun.file(path).text()) as ObjectValue;
	const jobs: Record<string, WorkflowJob> = {};
	for (const [id, rawJob] of Object.entries(object(source.jobs))) {
		const job = object(rawJob);
		jobs[id] = {
			name: typeof job.name === "string" ? job.name : id,
			steps: Array.isArray(job.steps)
				? job.steps.map((step, index) => normalizeStep(step, index))
				: [],
		};
	}

	const schedule = object(source.on).schedule;
	const crons = Array.isArray(schedule)
		? schedule
				.map((item) => object(item).cron)
				.filter((cron): cron is string => typeof cron === "string")
		: [];
	const filename = basename(path);
	return {
		id: filename.slice(0, -extname(filename).length),
		path,
		name: typeof source.name === "string" ? source.name : filename,
		crons,
		jobs,
	};
}

export async function discoverWorkflows(root: string): Promise<Workflow[]> {
	const directory = resolve(root, ".github/workflows");
	let names: string[];
	try {
		names = await readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return Promise.all(
		names
			.filter((name) => [".yml", ".yaml"].includes(extname(name)))
			.sort()
			.map((name) => readWorkflow(resolve(directory, name))),
	);
}

function fieldMatches(field: string, value: number, minimum: number): boolean {
	return field.split(",").some((part) => {
		const [rangeExpression, stepExpression] = part.split("/");
		const step = stepExpression ? Number(stepExpression) : 1;
		if (!Number.isInteger(step) || step < 1) return false;
		let start: number;
		let end: number;
		if (rangeExpression === "*") {
			start = minimum;
			end = Number.POSITIVE_INFINITY;
		} else if (rangeExpression?.includes("-")) {
			[start, end] = rangeExpression.split("-").map(Number) as [number, number];
		} else {
			start = Number(rangeExpression);
			end = start;
		}
		return value >= start && value <= end && (value - start) % step === 0;
	});
}

export function cronMatches(expression: string, date: Date): boolean {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) return false;
	const values = [
		date.getUTCMinutes(),
		date.getUTCHours(),
		date.getUTCDate(),
		date.getUTCMonth() + 1,
		date.getUTCDay(),
	];
	const minima = [0, 0, 1, 1, 0];
	return fields.every((field, index) =>
		fieldMatches(field, values[index] as number, minima[index] as number),
	);
}

export function localActionSteps(workflow: Workflow) {
	return Object.entries(workflow.jobs).flatMap(([jobId, job]) =>
		job.steps
			.filter((step) => step.uses?.startsWith("./"))
			.map((step) => ({ jobId, step })),
	);
}
