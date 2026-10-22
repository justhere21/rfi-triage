import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import { assertValidOutput } from "./validate.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const OUTPUT_SCHEMA = JSON.parse(
  readFileSync(
    new URL("../schemas/output_schema.json", import.meta.url),
    "utf8"
  )
);

const promptTemplate = readFileSync(
  new URL("../prompts/triage_prompt.txt", import.meta.url),
  "utf8"
);

function renderPrompt({ item_id, question_text }) {
  return promptTemplate
    .replaceAll("{{item_id}}", item_id)
    .replaceAll("{{rfi_text}}", question_text);
}

export async function triageRfi(rfi) {
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

  assertValidOutput(result, `LLM output for ${rfi.item_id}`);

  return {
    raw,
    result
  };
}