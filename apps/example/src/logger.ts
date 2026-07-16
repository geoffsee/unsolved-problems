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

const level = process.env.LOG_LEVEL ?? "debug";
const maxChars = Number(process.env.LOG_MAX_CHARS ?? 4_000);

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

export function summarizeContentBlocks(
	content: unknown,
): Array<Record<string, unknown>> {
	if (!Array.isArray(content)) {
		return [{ type: typeof content, value: truncate(content) }];
	}

	return content.map((block) => {
		if (!block || typeof block !== "object") {
			return { type: typeof block, value: truncate(block) };
		}

		const item = block as Record<string, unknown>;
		const type = String(item.type ?? "unknown");

		switch (type) {
			case "text":
				return { type, text: truncate(item.text) };
			case "thinking":
				return { type, thinking: truncate(item.thinking) };
			case "tool_use":
				return {
					type,
					id: item.id,
					name: item.name,
					input: truncate(item.input),
				};
			case "tool_result":
				return {
					type,
					tool_use_id: item.tool_use_id,
					is_error: item.is_error ?? false,
					content: truncate(item.content),
				};
			default:
				return { type, value: truncate(item) };
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
		input: truncate(input),
	});

	try {
		const response = await run();
		logger.info("tool finished", {
			toolName,
			durationMs: Date.now() - startedAt,
			response: truncate(response),
		});
		return response;
	} catch (error) {
		logger.error("tool failed", {
			toolName,
			durationMs: Date.now() - startedAt,
			input: truncate(input),
			err: error,
		});
		throw error;
	}
}
