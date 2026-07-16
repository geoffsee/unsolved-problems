import pino from "pino";
import pretty from "pino-pretty";

export type LogAttributes = Record<string, unknown>;

export interface Logger {
	child(bindings: LogAttributes): Logger;
	debug(message: string, attributes?: LogAttributes): void;
	info(message: string, attributes?: LogAttributes): void;
	warn(message: string, attributes?: LogAttributes): void;
	error(message: string, attributes?: LogAttributes): void;
}

const level = process.env.LOG_LEVEL ?? "info";
const maxChars = Number(process.env.LOG_MAX_CHARS ?? 240);
const previewChars = Number(process.env.LOG_PREVIEW_CHARS ?? 160);

const TOOL_ARG_KEYS = [
	"query",
	"problemId",
	"agentId",
	"status",
	"limit",
	"category",
	"kind",
	"title",
	"entity_type",
	"id",
	"url",
	"queryAuthor",
	"sort",
	"leaseMinutes",
] as const;

const destination =
	process.stdout.isTTY || process.env.LOG_PRETTY === "1"
		? pretty({
				colorize: true,
				translateTime: "SYS:standard",
				ignore: "pid,hostname",
			})
		: process.stdout;

const rootPino = pino(
	{
		level,
		base: undefined,
		serializers: {
			err: pino.stdSerializers.err,
		},
	},
	destination,
);

function wrap(instance: pino.Logger): Logger {
	return {
		child(bindings) {
			return wrap(instance.child(bindings));
		},
		debug(message, attributes) {
			instance.debug(attributes ?? {}, message);
		},
		info(message, attributes) {
			instance.info(attributes ?? {}, message);
		},
		warn(message, attributes) {
			instance.warn(attributes ?? {}, message);
		},
		error(message, attributes) {
			instance.error(attributes ?? {}, message);
		},
	};
}

/** Shared process logger. Prefer `createLogger({ agent: "..." })` in runners. */
export const log = wrap(rootPino);

export function createLogger(bindings?: LogAttributes): Logger {
	return bindings ? log.child(bindings) : log;
}

export function truncate(value: unknown, limit = maxChars): unknown {
	if (typeof value === "string") {
		if (value.length <= limit) {
			return value;
		}
		return `${value.slice(0, limit)}…[+${value.length - limit} chars]`;
	}

	if (Array.isArray(value)) {
		return value.map((item) => truncate(item, limit));
	}

	if (value && typeof value === "object") {
		try {
			const json = JSON.stringify(value);
			if (json.length <= limit) {
				return value;
			}
			return `${json.slice(0, limit)}…[+${json.length - limit} chars]`;
		} catch {
			return String(value);
		}
	}

	return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function tryParseJson(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return value;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

function countField(record: Record<string, unknown>, key: string) {
	const value = record[key];
	if (Array.isArray(value)) {
		return value.length;
	}
	return undefined;
}

/** Compact tool args: keep only the fields that show intent. */
export function summarizeToolArgs(
	input: unknown,
): LogAttributes | string | null {
	if (input == null) {
		return null;
	}

	if (typeof input === "string") {
		return String(truncate(input, previewChars));
	}

	const record = asRecord(input);
	if (!record) {
		return truncate(input, previewChars) as LogAttributes | string;
	}

	const summary: LogAttributes = {};
	for (const key of TOOL_ARG_KEYS) {
		if (record[key] == null || record[key] === "") {
			continue;
		}
		summary[key] = truncate(record[key], previewChars);
	}

	if (Object.keys(summary).length === 0) {
		return truncate(record, previewChars) as LogAttributes | string;
	}

	return summary;
}

/** Compact tool outcomes: counts / ids / short preview — never the full payload. */
export function summarizeToolOutcome(response: unknown): LogAttributes {
	if (response == null) {
		return { empty: true };
	}

	const parsed = tryParseJson(response);
	const summary: LogAttributes = {};

	if (typeof response === "string") {
		summary.chars = response.length;
	} else {
		try {
			summary.chars = JSON.stringify(response).length;
		} catch {
			summary.chars = undefined;
		}
	}

	const record = asRecord(parsed);
	if (record) {
		for (const key of [
			"items",
			"works",
			"matches",
			"results",
			"problems",
			"claims",
		] as const) {
			const count = countField(record, key);
			if (count !== undefined) {
				summary[`${key}Count`] = count;
			}
		}

		const meta = asRecord(record.meta);
		if (typeof meta?.count === "number") {
			summary.resultCount = meta.count;
		}

		const nestedContent = tryParseJson(record.content);
		const nested = asRecord(nestedContent);
		if (nested) {
			for (const key of ["items", "works", "matches", "results"] as const) {
				const count = countField(nested, key);
				if (count !== undefined) {
					summary[`${key}Count`] ??= count;
				}
			}
			const claim = asRecord(nested.claim);
			if (typeof claim?.claimId === "string") {
				summary.claimId = claim.claimId;
			}
			if (typeof claim?.problemId === "string") {
				summary.problemId = claim.problemId;
			}
			const problem = asRecord(nested.problem);
			if (typeof problem?.id === "string") {
				summary.problemId ??= problem.id;
			}
			const nestedMeta = asRecord(nested.meta);
			if (typeof nestedMeta?.count === "number") {
				summary.resultCount ??= nestedMeta.count;
			}
		}

		if (Array.isArray(record.matches)) {
			summary.matches = truncate(record.matches, previewChars);
		}
		if (typeof record.problemId === "string") {
			summary.problemId ??= record.problemId;
		}
		if (typeof record.claimId === "string") {
			summary.claimId ??= record.claimId;
		}
	} else if (Array.isArray(parsed)) {
		summary.itemsCount = parsed.length;
	} else if (typeof parsed === "string") {
		summary.preview = truncate(parsed, previewChars);
	}

	return summary;
}

export type AssistantActivity = {
	text?: string;
	tools?: string[];
	thinking?: boolean;
};

/** Extract what the model is saying / which tools it is about to call. */
export function summarizeAssistantActivity(
	content: unknown,
): AssistantActivity {
	if (!Array.isArray(content)) {
		if (typeof content === "string" && content.trim()) {
			return { text: String(truncate(content, previewChars)) };
		}
		return {};
	}

	const tools: string[] = [];
	const textParts: string[] = [];
	let thinking = false;

	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}
		const item = block as Record<string, unknown>;
		const type = String(item.type ?? "");

		if (type === "text" && typeof item.text === "string" && item.text.trim()) {
			textParts.push(item.text.trim());
		} else if (type === "thinking") {
			thinking = true;
		} else if (type === "tool_use" && typeof item.name === "string") {
			tools.push(item.name);
		}
	}

	const activity: AssistantActivity = {};
	if (textParts.length > 0) {
		activity.text = String(truncate(textParts.join("\n"), previewChars));
	}
	if (tools.length > 0) {
		activity.tools = tools;
	}
	if (thinking) {
		activity.thinking = true;
	}
	return activity;
}

export function summarizeContentBlocks(
	content: unknown,
): Array<Record<string, unknown>> {
	if (!Array.isArray(content)) {
		return [{ type: typeof content, value: truncate(content, previewChars) }];
	}

	return content.map((block) => {
		if (!block || typeof block !== "object") {
			return { type: typeof block, value: truncate(block, previewChars) };
		}

		const item = block as Record<string, unknown>;
		const type = String(item.type ?? "unknown");

		switch (type) {
			case "text":
				return { type, text: truncate(item.text, previewChars) };
			case "thinking":
				return { type, thinking: true };
			case "tool_use":
				return {
					type,
					name: item.name,
					input: summarizeToolArgs(item.input),
				};
			case "tool_result":
				return {
					type,
					tool_use_id: item.tool_use_id,
					is_error: item.is_error ?? false,
					outcome: summarizeToolOutcome(item.content),
				};
			default:
				return { type };
		}
	});
}

export async function withToolLogging<T>(
	logger: Logger,
	toolName: string,
	input: unknown,
	run: () => Promise<T>,
): Promise<T> {
	const startedAt = Date.now();
	logger.info("tool starting", {
		toolName,
		args: summarizeToolArgs(input),
	});

	try {
		const response = await run();
		logger.info("tool finished", {
			toolName,
			durationMs: Date.now() - startedAt,
			outcome: summarizeToolOutcome(response),
		});
		return response;
	} catch (error) {
		logger.error("tool failed", {
			toolName,
			durationMs: Date.now() - startedAt,
			args: summarizeToolArgs(input),
			err: error,
		});
		throw error;
	}
}
