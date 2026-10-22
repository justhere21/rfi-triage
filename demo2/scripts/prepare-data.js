import fs from "node:fs";
import path from "node:path";
import { artifacts, buildDataset, OUTPUT_DIR, REPO_ROOT, serialize } from "./lib/prepare.js";

try {
  if (process.argv.length > 2) throw new Error("Usage: npm run prepare-data (no arguments)");
  const dataset = buildDataset();
  for (const source of [...dataset.report.sources, dataset.report.answer_source]) {
    console.log(`${source.file}: ${source.records} records, ${source.converted} converted, ${source.failed} failed`);
  }
  if (!dataset.report.valid) {
    console.error(serialize(dataset.report.errors));
    throw new Error("Preparation failed; prepared files were not updated");
  }
  const directory = path.join(REPO_ROOT, OUTPUT_DIR);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts(dataset))) {
    fs.writeFileSync(path.join(directory, name), serialize(value));
  }
  console.log(`Prepared ${dataset.items.length} inputs and ${dataset.answerKey.length} separate source answers in ${OUTPUT_DIR}`);
  console.log(`${dataset.report.warnings.length} documented warnings; inspect validation-report.json before scoring.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
