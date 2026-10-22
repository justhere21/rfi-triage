import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { triage } from "./triage.js";
import { assertValidInput, validateOutput } from "./validate.js";

const FILE_PATHS = [
  "samples/Sample_RFI-014.json",
  "samples/Sample_RFI-015.json",
  "samples/Sample_RFI-016.json",
  "samples/Sample_RFI-017.json",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export function runSamples(filePaths = FILE_PATHS) {
  for (const filePath of filePaths) {
    const absoluteInputPath = path.join(projectRoot, filePath);
    const raw = fs.readFileSync(absoluteInputPath, "utf8");
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      assertValidInput(item, filePath);

      const output = triage(item);
      if (!validateOutput(output)) {
        console.error(`Validation failed for ${filePath}:`, validateOutput.errors);
        throw new Error("Output validation failed");
      }

      if (output.item_id !== item.item_id) {
        throw new Error(`Output item_id does not match input item_id for ${filePath}`);
      }

      const outputDir = path.join(projectRoot, "results");
      fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `${output.item_id}_results.json`);
      fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
      console.log(JSON.stringify(output, null, 2));
      console.log(`Saved to ${outputPath}`);
      console.log("---");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSamples();
}
