import { connect, createServer } from "node:net";

const publicPort = Number.parseInt(process.argv[2] ?? "3032", 10);
const upstreamPort = Number.parseInt(process.argv[3] ?? "3032", 10);

const server = createServer((client) => {
	const upstream = connect({ host: "::1", port: upstreamPort });
	client.pipe(upstream);
	upstream.pipe(client);
	client.on("error", () => upstream.destroy());
	upstream.on("error", () => client.destroy());
});

server.listen(publicPort, "0.0.0.0", () => {
	console.log(
		`Muxox Web UI proxy listening on 0.0.0.0:${publicPort} -> [::1]:${upstreamPort}`,
	);
});

function shutdown() {
	server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
