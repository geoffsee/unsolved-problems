#!/usr/bin/env bun
import {
	type CategoryManifest,
	getDataShapeValidationErrors,
	getDataValidationErrors,
	type PublishedDataKind,
	parseManifestJson,
	validateManifest,
} from "../lib/manifest";

const apiOrigin = (
	Bun.env.PUBLISH_API_ORIGIN || "http://localhost:3040/api"
).replace(/\/+$/, "");
const key = Bun.env.PUBLISH_KEY;
if (!key) throw new Error("PUBLISH_KEY is required");

function usage(): never {
	throw new Error(
		"Usage: open-questions-publish [--manifest <path>] <file> [...files]",
	);
}

function parseArgs(args: string[]) {
	let manifestPath: string | undefined;
	const files: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--manifest") {
			manifestPath = args[++index];
			if (!manifestPath) usage();
			continue;
		}
		if (arg?.startsWith("--manifest=")) {
			manifestPath = arg.slice("--manifest=".length);
			if (!manifestPath) usage();
			continue;
		}
		if (arg?.startsWith("--")) usage();
		if (arg) files.push(arg);
	}
	if (!files.length) usage();
	return { manifestPath, files };
}

function publishedPath(file: string): string {
	const normalized = file.replaceAll("\\", "/");
	const marker = "/public/data/";
	const markerIndex = normalized.lastIndexOf(marker);
	const relative =
		markerIndex >= 0
			? normalized.slice(markerIndex + marker.length)
			: normalized.replace(/^public\/data\//, "");
	return `/data/${relative}`;
}

function dataKind(path: string): PublishedDataKind {
	if (path === "/data/manifest.json") return "manifest";
	if (path === "/data/problems.json") return "problems";
	if (path === "/data/news.json") return "news";
	if (path === "/data/cases.json") return "cases";
	if (path === "/data/enrichments.json") return "enrichments";
	if (path === "/data/news-history/index.json") return "news-history-index";
	if (path.startsWith("/data/news-history/")) return "news-history";
	if (path === "/data/case-history/index.json") return "case-history-index";
	if (path.startsWith("/data/case-history/")) return "case-history";
	throw new Error(`Unsupported publish path derived from ${path}.`);
}

const { manifestPath, files } = parseArgs(Bun.argv.slice(2));
let manifest: CategoryManifest | undefined;
let manifestFileSource: string | undefined;
const payloads: Array<{ file: string; path: string; data: unknown }> = [];

if (manifestPath) {
	const manifestFile = Bun.file(manifestPath);
	if (!(await manifestFile.exists()))
		throw new Error(`Manifest not found at ${manifestPath}.`);
	manifest = parseManifestJson(await manifestFile.text());
}

for (const file of files) {
	const path = publishedPath(file);
	const data = await Bun.file(file)
		.json()
		.catch((error) => {
			throw new Error(
				`Unable to read JSON from ${file}: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	if (path === "/data/manifest.json") {
		manifest = validateManifest(data);
		manifestFileSource = file;
	} else {
		payloads.push({ file, path, data });
	}
}

if (manifest) {
	for (const payload of payloads) {
		const errors = getDataValidationErrors(
			manifest,
			payload.data,
			dataKind(payload.path),
		);
		if (errors.length)
			throw new Error(
				`Validation failed for ${payload.file}: ${errors.join("; ")}`,
			);
	}
} else {
	for (const payload of payloads) {
		const errors = getDataShapeValidationErrors(
			payload.data,
			dataKind(payload.path),
		);
		if (errors.length)
			throw new Error(
				`Validation failed for ${payload.file}: ${errors.join("; ")}`,
			);
	}
}

const toPublish = [
	...(manifest && (manifestPath || manifestFileSource)
		? [
				{
					file: manifestPath ?? manifestFileSource ?? "manifest.json",
					path: "/data/manifest.json",
					data: manifest,
				},
			]
		: []),
	...payloads,
];

for (const payload of toPublish) {
	const response = await fetch(`${apiOrigin}/publish`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ path: payload.path, data: payload.data }),
	});
	if (!response.ok)
		throw new Error(
			`Publishing ${payload.file} failed: ${response.status} ${await response.text()}`,
		);
	console.log(`Published ${payload.path}`);
}
