import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPartnerDataset } from "./lib/partner.js";
import { REPO_ROOT, serialize } from "./lib/prepare.js";

const OUTPUT_NAMES = ["items.json", "manifest.json", "validation-report.json"];
const USAGE = "Usage: npm run prepare-partner -- --input FILE --receipt RECEIPT.json [--out-dir DIR] [--dry-run]";

export function parsePartnerArgs(args) {
  const options = { dryRun: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--input", "--receipt", "--out-dir"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`);
      options[{ "--input": "inputPath", "--receipt": "receiptPath", "--out-dir": "outDir" }[arg]] = path.resolve(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && (!options.inputPath || !options.receiptPath)) throw new Error(USAGE);
  return options;
}

function canonicalPath(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent = path.dirname(file);
  return parent === file ? file : path.join(canonicalPath(parent), path.basename(file));
}

function checkOutputPaths(directory, sourceFiles) {
  const protectedPaths = sourceFiles.map((file) => canonicalPath(file).toLowerCase());
  for (const name of OUTPUT_NAMES) {
    const file = path.join(directory, name);
    try {
      const info = fs.lstatSync(file);
      if (info.isSymbolicLink() || info.nlink > 1) throw new Error(`Output ${name} could overwrite linked data; symlink or shared hard link outputs are not allowed. Choose another --out-dir`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const target = canonicalPath(file).toLowerCase();
    if (protectedPaths.includes(target)) throw new Error(`Output ${name} would overwrite a source or receipt file; choose another --out-dir`);
  }
  const synthetic = canonicalPath(path.join(REPO_ROOT, "data/prepared/synthetic")).toLowerCase();
  const target = canonicalPath(directory).toLowerCase();
  if (target === synthetic || target.startsWith(synthetic + path.sep)) {
    throw new Error("Partner outputs must stay outside data/prepared/synthetic; choose a separate --out-dir");
  }
}

export function runPartnerPreparation(args = process.argv.slice(2), { logger = console } = {}) {
  const options = parsePartnerArgs(args);
  if (options.help) { logger.log(USAGE); return { exitCode: 0 }; }
  const dataset = buildPartnerDataset(options);
  for (const source of dataset.report.sources ?? []) {
    logger.log(`${source.file}: ${source.records} records, ${source.converted} converted, ${source.failed} failed`);
  }
  if (!dataset.report.valid) {
    logger.error(serialize(dataset.report.errors));
    return { exitCode: 1, dataset };
  }
  const directory = options.outDir ?? path.join(REPO_ROOT, "data/prepared/partner", dataset.manifest.dataset_id);
  checkOutputPaths(directory, [options.inputPath, options.receiptPath]);
  if (options.dryRun) {
    logger.log(`Dry run: validated ${dataset.items.length} partner inputs. No files or model calls were made.`);
    return { exitCode: 0, dataset, directory };
  }
  fs.mkdirSync(directory, { recursive: true });
  const values = [dataset.items, dataset.manifest, dataset.report];
  for (const [index, name] of OUTPUT_NAMES.entries()) fs.writeFileSync(path.join(directory, name), serialize(values[index]));
  logger.log(`Prepared ${dataset.items.length} partner inputs in ${directory}. Source and receipt files were not changed.`);
  return { exitCode: 0, dataset, directory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runPartnerPreparation().exitCode; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
