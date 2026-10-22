import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGeneratedDataset, DEFAULT_GENERATION_SEED, validateSeed } from "./lib/generate-synthetic.js";

export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DEFAULT_OUTPUT = path.join(REPO_ROOT, "data/prepared/generated-synthetic");
const NAMES = ["items.json", "answer-key.json", "manifest.json", "validation-report.json"];
const USAGE = "Usage: npm run generate-synthetic -- [--seed UINT32] [--out-dir DIR] [--dry-run]";

export function parseGenerationArgs(args) {
  const options = { seed: DEFAULT_GENERATION_SEED, outDir: DEFAULT_OUTPUT, dryRun: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (["--help", "-h"].includes(arg)) options.help = true;
    else if (["--seed", "--out-dir"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--seed") {
        if (!/^\d+$/.test(value)) throw new Error("Seed must be an integer from 0 through 4294967295");
        options.seed = validateSeed(Number(value));
      } else options.outDir = path.resolve(value);
    } else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  return options;
}

function canonicalPath(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent = path.dirname(file);
  return parent === file ? file : path.join(canonicalPath(parent), path.basename(file));
}

function protectOutput(directory) {
  const canonical = canonicalPath(directory).toLowerCase();
  for (const protectedDirectory of ["data/synthetic", "data/partner", "data/prepared/synthetic", "data/prepared/partner"]) {
    const protectedPath = canonicalPath(path.join(REPO_ROOT, protectedDirectory)).toLowerCase();
    if (canonical === protectedPath || canonical.startsWith(protectedPath + path.sep) || protectedPath.startsWith(canonical + path.sep)) {
      throw new Error(`Generated output must stay separate from ${protectedDirectory}, including its ancestors and descendants`);
    }
  }
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("Generated output directory must not be a symlink");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const name of NAMES) {
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`Generated output ${name} must not be a symlink or shared hard link`);
      if (!stat.isFile()) throw new Error(`Generated output ${name} must be a regular file`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function runSyntheticGeneration(args = process.argv.slice(2), { logger = console } = {}) {
  const options = parseGenerationArgs(args);
  if (options.help) { logger.log(USAGE); return { exitCode: 0 }; }
  protectOutput(options.outDir);
  const dataset = buildGeneratedDataset({ seed: options.seed });
  if (!dataset.report.valid) { logger.error(JSON.stringify(dataset.report.errors, null, 2)); return { exitCode: 1, dataset }; }
  if (options.dryRun) {
    logger.log(`Dry run: constructed and validated ${dataset.items.length} optional synthetic fixtures with seed ${options.seed}. No files or model calls were made.`);
    return { exitCode: 0, dataset, directory: options.outDir };
  }
  fs.mkdirSync(options.outDir, { recursive: true });
  const values = [dataset.items, dataset.answerKey, dataset.manifest, dataset.report];
  for (const [index, name] of NAMES.entries()) fs.writeFileSync(path.join(options.outDir, name), JSON.stringify(values[index], null, 2) + "\n");
  logger.log(`Generated ${dataset.items.length} optional fixtures in ${options.outDir}. The original 23 cases were not changed.`);
  return { exitCode: 0, dataset, directory: options.outDir };
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runSyntheticGeneration().exitCode; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
