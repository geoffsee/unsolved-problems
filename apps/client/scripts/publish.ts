import { resolve } from "node:path";

const cli =
	Bun.env.PUBLISH_CLI || resolve(import.meta.dir, "../dist/publish-cli");
export async function publish(...files: string[]) {
	const configuredManifest =
		Bun.env.PUBLISH_MANIFEST ||
		Bun.env.OPEN_QUESTIONS_MANIFEST ||
		Bun.env.CATALOG_MANIFEST ||
		"public/data/manifest.json";
	const manifest = (await Bun.file(configuredManifest).exists())
		? configuredManifest
		: undefined;
	const args = manifest ? ["--manifest", manifest, ...files] : files;
	const proc = Bun.spawn([cli, ...args], {
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await proc.exited) !== 0)
		throw new Error(`Publish CLI failed (${proc.exitCode})`);
}
