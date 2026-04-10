#!/usr/bin/env node
/**
 * Gzip-compresses all JSON files in public/data/ for smaller transfer sizes.
 * The uncompressed originals are kept so other scripts (e.g. enrich-data) can
 * still read them directly.
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { gzipSync } from "zlib";

const DATA_DIR = resolve("public/data");

const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

for (const file of files) {
  const src = join(DATA_DIR, file);
  const dest = join(DATA_DIR, file + ".gz");
  const raw = readFileSync(src);
  const compressed = gzipSync(raw, { level: 9 });
  writeFileSync(dest, compressed);
  const pct = ((1 - compressed.length / raw.length) * 100).toFixed(1);
  console.log(`  ${file}: ${raw.length} → ${compressed.length} bytes (${pct}% smaller)`);
}

console.log(`\nCompressed ${files.length} files.`);