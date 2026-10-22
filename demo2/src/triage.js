import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import { assertValidOutput } from "./validate.js";

const OUTPUT_SCHEMA = JSON.parse(
  readFileSync(
    new URL("../schemas/triage_output_schema.json", import.meta.url),
    "utf8"
  )
);

export const promptTemplate = readFileSync(
  new URL("../prompts/triage_prompt.txt", import.meta.url),
  "utf8"
);

let ai;
function client() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Copy '.env .example' to .env and add your key.");
  }
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

function formatDailyReport(report) {
  return [
    `- Report ID: ${report.report_id}`,
    `  Date: ${report.report_date}`,
    `  Reported By: ${report.reported_by}`,
    `  Location: ${report.location}`,
    report.labor_count == null ? null : `  Labor Count: ${report.labor_count}`,
    `  Work Description: ${report.work_description}`
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderPrompt(rfi, dailyReports = []) {
  const rfiText = [
    `Title: ${rfi.title}`,
    `Project: ${rfi.project_id}`,
    `Submitted By: ${rfi.submitted_by}`,
    `Date Submitted: ${rfi.date_submitted}`,
    rfi.spec_section ? `Spec Section: ${rfi.spec_section}` : null,
    `Description: ${rfi.description}`,
    "",
    "Linked Daily Field Reports:",
    dailyReports.length
      ? dailyReports.map(formatDailyReport).join("\n")
      : "None supplied."
  ]
    .filter((line) => line !== null)
    .join("\n");

  return promptTemplate
    .replaceAll("{{item_id}}", rfi.rfi_id)
    .replaceAll("{{rfi_text}}", rfiText);
}

export async function triageRfi(rfi, dailyReports = []) {
  const prompt = renderPrompt(rfi, dailyReports);

  const response = await client().models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: OUTPUT_SCHEMA
    }
  });

  const raw = response.text;
  const result = JSON.parse(raw);

  assertValidOutput(result, rfi.rfi_id);

  return {
    prompt,
    raw,
    result
  };
}
