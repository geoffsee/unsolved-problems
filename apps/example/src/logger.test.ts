import { describe, expect, mock, test } from "bun:test";
import {
	createLogger,
	summarizeContentBlocks,
	truncate,
	withToolLogging,
} from "./logger";

describe("truncate", () => {
	test("leaves short strings alone", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	test("shortens long strings with a remainder marker", () => {
		expect(truncate("abcdefghij", 4)).toBe("abcd…[+6 chars]");
	});

	test("truncates nested object json when needed", () => {
		const value = truncate({ hello: "world".repeat(20) }, 20);
		expect(typeof value).toBe("string");
		expect(String(value)).toContain("…[+");
	});

	test("maps array values recursively", () => {
		expect(truncate(["abcd", "ef"], 2)).toEqual(["ab…[+2 chars]", "ef"]);
	});
});

describe("summarizeContentBlocks", () => {
	test("wraps non-array content", () => {
		expect(summarizeContentBlocks("hi")).toEqual([
			{ type: "string", value: "hi" },
		]);
	});

	test("summarizes known block types", () => {
		expect(
			summarizeContentBlocks([
				{ type: "text", text: "hello" },
				{ type: "thinking", thinking: "hmm" },
				{
					type: "tool_use",
					id: "1",
					name: "list_problems",
					input: { limit: 5 },
				},
				{
					type: "tool_result",
					tool_use_id: "1",
					is_error: false,
					content: "ok",
				},
				{ type: "other", payload: true },
			]),
		).toEqual([
			{ type: "text", text: "hello" },
			{ type: "thinking", thinking: "hmm" },
			{
				type: "tool_use",
				id: "1",
				name: "list_problems",
				input: { limit: 5 },
			},
			{
				type: "tool_result",
				tool_use_id: "1",
				is_error: false,
				content: "ok",
			},
			{ type: "other", value: { type: "other", payload: true } },
		]);
	});
});

describe("withToolLogging", () => {
	test("logs success and returns the tool result", async () => {
		const logger = {
			child: () => logger,
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};

		const result = await withToolLogging(
			logger,
			"list_problems",
			{ limit: 1 },
			async () => ({
				ok: true,
			}),
		);

		expect(result).toEqual({ ok: true });
		expect(logger.info).toHaveBeenCalledTimes(2);
	});

	test("logs failures and rethrows", async () => {
		const logger = {
			child: () => logger,
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		};

		await expect(
			withToolLogging(logger, "pick_problem", {}, async () => {
				throw new Error("nope");
			}),
		).rejects.toThrow("nope");
		expect(logger.error).toHaveBeenCalledTimes(1);
	});
});

describe("createLogger", () => {
	test("returns a logger with the expected methods", () => {
		const logger = createLogger({ agent: "test" });
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.child({ run: "1" }).debug).toBe("function");
	});
});
