import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const inputSchema = JSON.parse(
  readFileSync(new URL("../schemas/input_schema.json", import.meta.url), "utf8")
);
const outputSchema = JSON.parse(
  readFileSync(new URL("../schemas/output_schema.json", import.meta.url), "utf8")
);

export const validateInput = ajv.compile(inputSchema);
export const validateOutput = ajv.compile(outputSchema);

export function assertValidInput(item, source = "input") {
  if (!validateInput(item)) {
    throw new Error(
      `Input validation failed for ${source}:\n` +
        JSON.stringify(validateInput.errors, null, 2)
    );
  }
}

export function assertValidOutput(output, source = "output") {
  if (!validateOutput(output)) {
    throw new Error(
      `Output validation failed for ${source}:\n` +
        JSON.stringify(validateOutput.errors, null, 2)
    );
  }
}