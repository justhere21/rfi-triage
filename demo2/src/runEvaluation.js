import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const DATA_DIR = "data/synthetic";
const RESULTS_DIR = "results";


const INPUT_SCHEMA = JSON.parse(
  fs.readFileSync(new URL("../schemas/rfi_schema.json", import.meta.url), "utf8")
);
const OUTPUT_SCHEMA = JSON.parse(
  fs.readFileSync(new URL("../schemas/triage_output_schema.json", import.meta.url), "utf8")
);

const promptTemplate = fs.readFileSync(
  new URL("../prompts/triage_prompt.txt", import.meta.url),
  "utf8"
);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validateInput = ajv.compile(INPUT_SCHEMA);
const validateOutput = ajv.compile(OUTPUT_SCHEMA);

function assertValidInput(item, source = "input") {
  if (!validateInput(item)) {
    throw new Error(
      `Input validation failed for ${source}:\n` +
        JSON.stringify(validateInput.errors, null, 2)
    );
  }
}

function assertValidOutput(output, source = "output") {
  if (!validateOutput(output)) {
    throw new Error(
      `Output validation failed for ${source}:\n` +
        JSON.stringify(validateOutput.errors, null, 2)
    );
  }
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

function renderPrompt({
  rfi_id,
  title,
  description,
  spec_section,
  linked_daily_report_ids
}) {
  const rfiText = [
    `Title: ${title}`,
    spec_section ? `Spec Section: ${spec_section}` : null,
    linked_daily_report_ids.length
      ? `Related Daily Report IDs: ${linked_daily_report_ids.join(", ")}`
      : null,
    `Description: ${description}`
  ]
    .filter(Boolean)
    .join("\n");

  return promptTemplate
    .replaceAll("{{item_id}}", rfi_id)
    .replaceAll("{{rfi_text}}", rfiText);
}

async function triageRfi(rfi) {
  const prompt = renderPrompt(rfi);

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: OUTPUT_SCHEMA
    }
  });

  const raw = response.text;
  const result = JSON.parse(raw);

  assertValidOutput(result, `LLM output for ${rfi.rfi_id}`);

  if (result.rfi_id !== rfi.rfi_id) {
    throw new Error(
      `LLM output rfi_id "${result.rfi_id}" does not match input "${rfi.rfi_id}"`
    );
  }

  return {
    raw,
    result
  };
}

function getScenarioFiles(dataDir) {
  if (!fs.existsSync(dataDir)) {
    throw new Error(`Scenario directory not found: ${dataDir}`);
  }

  return fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(dataDir, file));
}

function loadScenarios(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(`${filePath} must contain a JSON array of RFIs`);
  }

  return data;
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const files = getScenarioFiles(DATA_DIR);

  if (files.length === 0) {
    throw new Error(`No JSON scenario files found in ${DATA_DIR}`);
  }

  let successCount = 0;
  let errorCount = 0;

  for (const filePath of files) {
    const scenarios = loadScenarios(filePath);

    for (const item of scenarios) {
      try {
        assertValidInput(item, `${filePath} [${item.rfi_id}]`);

        // triageRfi validates the model output against OUTPUT_SCHEMA
        const { raw, result } = await triageRfi(item);

        const outputPath = path.join(
          RESULTS_DIR,
          `${result.rfi_id}_results.json`
        );

        fs.writeFileSync(
          outputPath,
          JSON.stringify(
            {
              input_file: filePath,
              status: "success",
              raw_model_output: raw,
              triage_result: result
            },
            null,
            2
          ) + "\n"
        );

        successCount++;
        console.log(`Success: ${result.rfi_id}`);
      } catch (error) {
        errorCount++;

        const fallbackId = item?.rfi_id ?? "unknown_item";
        const outputPath = path.join(
          RESULTS_DIR,
          `${fallbackId}_results.json`
        );

        fs.writeFileSync(
          outputPath,
          JSON.stringify(
            {
              input_file: filePath,
              status: "error",
              error: error.message
            },
            null,
            2
          ) + "\n"
        );

        console.error(`Failed: ${fallbackId}`);
        console.error(error.message);
      }
    }
  }

  console.log(`\nEvaluation complete.`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${errorCount}`);
}

main();