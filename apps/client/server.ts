import { resolve, sep } from "node:path";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const publicDirectory = resolve(import.meta.dir, "dist/client");

Bun.serve({
	hostname: "0.0.0.0",
	port,
	async fetch(request) {
		const pathname = decodeURIComponent(new URL(request.url).pathname);
		const requestedPath = pathname.endsWith("/")
			? `${pathname}index.html`
			: pathname;
		const filePath = resolve(publicDirectory, `.${requestedPath}`);

		if (
			filePath.startsWith(`${publicDirectory}${sep}`) ||
			filePath === publicDirectory
		) {
			const file = Bun.file(filePath);
			if (await file.exists()) {
				return new Response(file);
			}
		}

		return new Response(Bun.file(resolve(publicDirectory, "404.html")), {
			status: 404,
		});
	},
});

console.log(`UI listening on http://0.0.0.0:${port}`);
