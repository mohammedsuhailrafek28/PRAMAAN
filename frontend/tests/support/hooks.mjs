// Resolves the app's "@/..." alias and extensionless imports so the real stores
// and API client can be loaded by Node's native TypeScript support.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");

function withExtension(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return undefined;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const url = withExtension(path.join(SRC, specifier.slice(2)));
    if (url) return nextResolve(url, context);
  }
  return nextResolve(specifier, context);
}
