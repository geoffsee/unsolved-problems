import { describe, expect, test } from "bun:test";
import { imageTag, smokeHost } from "./main";

describe("docker smoke test configuration", () => {
	test("uses the SHA for the image tag", () => {
		expect(imageTag("abc123")).toBe("open-questions:abc123");
	});

	test("provides local defaults", () => {
		expect(imageTag(undefined)).toBe("open-questions:local");
		expect(smokeHost(undefined)).toBe("127.0.0.1");
	});
});
