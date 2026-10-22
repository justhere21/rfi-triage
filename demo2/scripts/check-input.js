import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkItems } from "./lib/check-items.js";

export const DEFAULT_INPUT = fileURLToPath(new URL("../data/prepared/synthetic/items.json", import.meta.url));
const PROVENANCES = ["synthetic", "partner", "observed_public"];
const USAGE = "Usage: npm run check-input -- [--input FILE] [--provenance synthetic|partner|observed_public]";

export function loadPreparedItems(file = DEFAULT_INPUT, { provenance = "synthetic" } = {}) {
  if (!PROVENANCES.includes(provenance)) throw new Error(`Unknown provenance ${provenance}; choose ${PROVENANCES.join(", ")}`);
  let items;
  try {
    items = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Cannot read prepared input ${file}: ${error.message}`);
  }
  const checked = checkItems(items, { provenance });
  if (checked.errors.length) throw new Error(`Input validation failed for ${file}:\n${JSON.stringify(checked.errors, null, 2)}`);
  return items;
}

export function parseInputArgs(args) {
  const options = { input: DEFAULT_INPUT, provenance: "synthetic", help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input" || arg === "--provenance") {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a value`);
      if (arg === "--input") options.input = path.resolve(value);
      else options.provenance = value;
    } else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (!PROVENANCES.includes(options.provenance)) throw new Error(`Unknown provenance ${options.provenance}; choose ${PROVENANCES.join(", ")}`);
  return options;
}

export function runInputCheck(args = process.argv.slice(2), { logger = console } = {}) {
  try {
    const options = parseInputArgs(args);
    if (options.help) { logger.log(USAGE); return { exitCode: 0, validatedCount: 0 }; }
    const items = loadPreparedItems(options.input, { provenance: options.provenance });
    logger.log(`Validated ${items.length} ${options.provenance} inputs from ${options.input}. No files or model calls were made.`);
    return { exitCode: 0, validatedCount: items.length, input: options.input, provenance: options.provenance };
  } catch (error) {
    logger.error(error.message);
    return { exitCode: 1, validatedCount: 0 };
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runInputCheck().exitCode;
}
