import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { artifacts, buildDataset, OUTPUT_DIR, REPO_ROOT, serialize } from "./lib/prepare.js";
import { checkItems } from "./lib/check-items.js";

export function validatePrepared(root = REPO_ROOT) {
  let dataset;
  const errors = [];
  try {
    dataset = buildDataset(root);
    errors.push(...dataset.report.errors);
    for (const [name, expected] of Object.entries(artifacts(dataset))) {
      const file = path.join(root, OUTPUT_DIR, name);
      try {
        const actualText = fs.readFileSync(file, "utf8");
        const actual = JSON.parse(actualText);
        if (name === "items.json") errors.push(...checkItems(actual).errors);
        if (actualText !== serialize(expected)) errors.push({
          code: "stale_artifact", file: `${OUTPUT_DIR}/${name}`,
          message: "Prepared artifact differs from the deterministic source conversion. Run npm run prepare-data."
        });
      } catch (error) {
        errors.push({ code: "unreadable_artifact", file: `${OUTPUT_DIR}/${name}`, message: error.message });
      }
    }
  } catch (error) {
    errors.push({ code: "source_error", message: error.message });
  }
  return { valid: errors.length === 0, errors, dataset };
}

function main() {
  if (process.argv.length > 2) throw new Error("Usage: npm run validate-data (no arguments)");
  const result = validatePrepared();
  if (!result.valid) {
    console.error(serialize(result.errors));
    process.exitCode = 1;
    return;
  }
  for (const source of [...result.dataset.report.sources, result.dataset.report.answer_source]) {
    console.log(`${source.file}: ${source.records} records, ${source.converted} converted, ${source.failed} failed`);
  }
  console.log(`Validated ${result.dataset.items.length} inputs and ${result.dataset.answerKey.length} source answers; all four prepared artifacts are current.`);
  console.log(`${result.dataset.report.warnings.length} documented warnings; no model calls or file changes.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
