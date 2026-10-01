// Fails when the frontend disclosure catalogue drifts from the backend's
// canonical catalogue. Run with `npm run check:contract` (also part of `npm run check`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = readFileSync(path.resolve(here, "../../src/utils/disclosureCatalogue.ts"), "utf8");
const frontend = readFileSync(path.resolve(here, "../src/lib/disclosure.ts"), "utf8");

function parse(source, keyPattern) {
  const items = new Map();
  for (const match of source.matchAll(new RegExp(`key: ${keyPattern}, label: "([^"]+)"[^}]*kind: "(FIELD|EVIDENCE)"`, "g"))) {
    items.set(match[1], `${match[3]}:${match[2]}`);
  }
  return items;
}

const backendItems = parse(backend, `(?:"|DocumentType\\.)([A-Za-z_]+)"?`);
const frontendItems = parse(frontend, `"([A-Za-z_]+)"`);

const problems = [];
for (const [key, value] of backendItems) {
  if (!frontendItems.has(key)) problems.push(`missing in frontend: ${key} (${value})`);
  else if (frontendItems.get(key) !== value) problems.push(`mismatch for ${key}: backend ${value} vs frontend ${frontendItems.get(key)}`);
}
for (const key of frontendItems.keys()) if (!backendItems.has(key)) problems.push(`unknown to backend: ${key}`);

if (backendItems.size === 0) problems.push("could not parse backend catalogue");
if (problems.length) {
  console.error("Disclosure contract drift:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Disclosure contract in sync (${backendItems.size} items).`);
