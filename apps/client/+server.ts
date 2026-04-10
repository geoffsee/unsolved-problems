import { telefuncHandler } from "./server/telefunc-handler";
import vike from "@vikejs/h3";
import { createApp, toWebHandler } from "h3";
import type { Server } from "vike/types";

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

function getHandler() {
  const app = createApp();

  vike(app, [
    // Telefunc route. See https://telefunc.com
    telefuncHandler,
  ]);

  return toWebHandler(app);
}

// https://vike.dev/server
export default {
  fetch: getHandler(),
  prod: {
    port,
  },
} satisfies Server;
