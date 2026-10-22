import path from "node:path";
import { ROOT, OUTPUT, checkTriageOutputs, readJson, serialize, validateDemo2 } from "./lib/demo2-data.js";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--outputs" || !args[1] || args[1].startsWith("-"))) {
    throw new Error("Usage: npm run validate-demo2 -- [--outputs FILE]");
  }
  const checked = validateDemo2();
  if (!checked.valid) throw new Error(`Demo 2 validation failed; run npm run prepare-demo2 after reviewing source changes:\n${serialize(checked.errors)}`);
  if (args.length) {
    const rfis = readJson(path.join(ROOT, OUTPUT, "rfis.json"));
    const outputs = checkTriageOutputs(readJson(path.resolve(args[1])), rfis.map((rfi) => rfi.rfi_id));
    if (!outputs.valid) throw new Error(`Triage output validation failed:\n${serialize(outputs.errors)}`);
    console.log(`Validated triage output structure and exact ID coverage for ${rfis.length} cases. This does not evaluate correctness or approval enforcement.`);
  }
  console.log(`Verified ${checked.report.counts.model_inputs} reproducible Demo 2 inputs; ${checked.report.warnings.length} completeness warnings. No files written, answers loaded, or model calls made.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
