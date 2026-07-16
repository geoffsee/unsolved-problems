import * as core from "@actions/core";
import * as exec from "@actions/exec";

const container = `open-questions-smoke-${process.pid}`;

export function imageTag(sha = process.env.GITHUB_SHA): string {
	return `open-questions:${sha ?? "local"}`;
}

export function smokeHost(value = process.env.DOCKER_SMOKE_HOST): string {
	return value ?? "127.0.0.1";
}

async function docker(args: string[], cwd: string, ignoreReturnCode = false) {
	return exec.exec("docker", args, { cwd, ignoreReturnCode });
}

export async function run(): Promise<void> {
	const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
	const tag = imageTag();
	const host = smokeHost();
	try {
		if ((await docker(["build", "--tag", tag, "."], root)) !== 0) {
			throw new Error("Docker image build failed");
		}
		if (
			(await docker(
				[
					"run",
					"--detach",
					"--rm",
					"--name",
					container,
					"--publish",
					"3030:3030",
					"--publish",
					"3031:3031",
					"--publish",
					"3032:3032",
					tag,
				],
				root,
			)) !== 0
		) {
			throw new Error("Docker container did not start");
		}

		for (let attempt = 1; attempt <= 15; attempt++) {
			try {
				const [page, health, muxox] = await Promise.all([
					fetch(`http://${host}:3031/`).then((response) => response.text()),
					fetch(`http://${host}:3030/health`).then(
						(response) => response.json() as Promise<{ ok?: boolean }>,
					),
					fetch(`http://${host}:3032/`),
				]);
				if (
					page.includes('<div id="root">') &&
					health.ok === true &&
					muxox.ok
				) {
					return;
				}
			} catch {
				// The container may still be starting.
			}
			await new Promise((done) => setTimeout(done, 1_000));
		}
		await docker(["logs", container], root, true);
		throw new Error("Container did not become healthy within 15 seconds");
	} catch (error) {
		core.setFailed(error instanceof Error ? error.message : String(error));
	} finally {
		await docker(["stop", container], root, true);
	}
}
