#!/usr/bin/env node
/**
 * Prerenders the built SPA into static HTML using Puppeteer.
 *
 * 1. Starts a local static server on the dist/ folder
 * 2. Loads the page in headless Chrome
 * 3. Waits for the app to render (categories visible)
 * 4. Saves the fully-rendered HTML back to dist/index.html
 */

import { readFileSync, writeFileSync } from "fs";
import { createServer } from "http";
import { resolve, extname, join } from "path";
import puppeteer from "puppeteer";

const DIST = resolve("dist");
const PORT = 4173;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      // Strip base path and query string
      let pathname = req.url.replace(/\?.*$/, "");
      pathname = pathname.replace(/^\/unsolved-problems/, "") || "/";

      let filePath = join(DIST, pathname);
      if (pathname.endsWith("/")) filePath = join(filePath, "index.html");

      try {
        const data = readFileSync(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(data);
      } catch {
        // SPA fallback
        const index = readFileSync(join(DIST, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(index);
      }
    });

    server.listen(PORT, () => {
      console.log(`  Static server on http://localhost:${PORT}`);
      resolvePromise(server);
    });
  });
}

async function main() {
  console.log("Prerendering dist/index.html...\n");

  const server = await startServer();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/unsolved-problems/`, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    // Wait for the category grid to render (confirms app + data loaded)
    await page.waitForSelector("button", { timeout: 15000 });

    // Small extra wait for any remaining renders
    await new Promise((r) => setTimeout(r, 500));

    // Extract the fully rendered HTML
    const html = await page.content();

    // Write back to dist
    writeFileSync(join(DIST, "index.html"), html);

    // Also write a 404.html for GitHub Pages SPA routing
    writeFileSync(join(DIST, "404.html"), html);

    console.log("  Prerendered dist/index.html");
    console.log("  Created dist/404.html (SPA fallback)");
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
