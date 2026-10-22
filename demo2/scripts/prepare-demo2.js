import { prepareDemo2 } from "./lib/demo2-data.js";

try {
  if (process.argv.length > 2) throw new Error("Usage: npm run prepare-demo2 (no arguments)");
  const report = prepareDemo2();
  console.log(`Prepared ${report.counts.rfis} fictional RFIs, ${report.counts.daily_reports} daily reports, and ${report.counts.model_inputs} separate model inputs.`);
  console.log(`${report.warnings.length} completeness warnings preserved. No answers were loaded and no model was called.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
