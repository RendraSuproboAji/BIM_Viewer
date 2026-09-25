// Copies the web-ifc WASM binaries into public/ so the IFC loader can run
// fully offline instead of fetching them from a CDN at runtime.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "web-ifc");
const dest = join(root, "public", "web-ifc");

mkdirSync(dest, { recursive: true });
for (const file of ["web-ifc.wasm", "web-ifc-mt.wasm"]) {
  const from = join(src, file);
  if (!existsSync(from)) {
    console.warn(`[copy-wasm] missing ${from}, run npm install first`);
    continue;
  }
  copyFileSync(from, join(dest, file));
}
console.log(`[copy-wasm] web-ifc WASM copied to ${dest}`);
