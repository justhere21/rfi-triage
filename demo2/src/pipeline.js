import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRfi, validateDailyReport } from "./validate.js";
import { evaluateResult, loadAnswerKey } from "./evaluate.js";

const DEMO2_DIR = fileURLToPath(new URL("../", import.meta.url));
export const RESULTS_DIR = path.join(DEMO2_DIR, "results");
export const PREPARED_DIR = path.join(DEMO2_DIR, "data", "prepared", "synthetic");
export const UPLOADS_DIR = path.join(DEMO2_DIR, "data", "uploads");
const UPLOADED_REPORTS = path.join(UPLOADS_DIR, "daily-reports.json");

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};

export const HUMAN_ACTIONS = {
  approve: { approval_status: "Approved" },
  flag: { approval_status: "Conflict Flagged" },
  clarify: { approval_status: "Pending Review", current_assignee: "Subcontractor" }
};

/** Status shown in the UI: a human decision overrides the AI's suggestion. */
export function displayStatus(record) {
  if (record.status !== "triaged") return null;
  return record.human_decision?.approval_status ?? record.triage_result.approval_status;
}

export function recordKey(rfi, fallback) {
  const id = rfi?.rfi_id;
  return typeof id === "string" && SAFE_ID.test(id) ? id : fallback;
}

const resultPath = (key, resultsDir) => path.join(resultsDir, `${key}_results.json`);

/* ---------- daily report pool ---------- */

export function loadDailyReportPool() {
  const prepared = readJson(path.join(PREPARED_DIR, "daily-reports.json"));
  const uploaded = fs.existsSync(UPLOADED_REPORTS) ? readJson(UPLOADED_REPORTS) : [];
  const pool = new Map();
  for (const report of [...prepared, ...uploaded]) pool.set(report.report_id, report);
  return [...pool.values()];
}

/** Validates uploaded daily reports; only valid ones are added to the pool. */
export function addDailyReports(reports) {
  const accepted = [];
  const rejected = [];
  for (const report of reports) {
    const check = validateDailyReport(report);
    if (check.valid) accepted.push(report);
    else rejected.push({ report_id: report?.report_id ?? null, errors: check.errors });
  }
  if (accepted.length) {
    const existing = fs.existsSync(UPLOADED_REPORTS) ? readJson(UPLOADED_REPORTS) : [];
    const ids = new Set(accepted.map((report) => report.report_id));
    writeJson(UPLOADED_REPORTS, [...existing.filter((report) => !ids.has(report.report_id)), ...accepted]);
  }
  return { accepted: accepted.map((report) => report.report_id), rejected };
}

/* ---------- stored records ---------- */

export function saveRecord(record, resultsDir = RESULTS_DIR) {
  writeJson(resultPath(record.key, resultsDir), record);
  return record;
}

export function getRecord(key, resultsDir = RESULTS_DIR) {
  if (!SAFE_ID.test(key)) return null;
  const file = resultPath(key, resultsDir);
  return fs.existsSync(file) ? readJson(file) : null;
}

export function listRecords(resultsDir = RESULTS_DIR) {
  if (!fs.existsSync(resultsDir)) return [];
  return fs
    .readdirSync(resultsDir)
    .filter((name) => name.endsWith("_results.json"))
    .map((name) => readJson(path.join(resultsDir, name)))
    .filter((record) => record && record.key)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function queueRfi(rfi, key, resultsDir = RESULTS_DIR) {
  return saveRecord({ key, status: "queued", rfi, queued_at: new Date().toISOString() }, resultsDir);
}

export function recordDecision(key, action, note = "", resultsDir = RESULTS_DIR) {
  const record = getRecord(key, resultsDir);
  if (!record) throw new Error(`No RFI found for ${key}`);
  if (record.status !== "triaged") throw new Error(`${key} has not been triaged`);
  const change = HUMAN_ACTIONS[action];
  if (!change) throw new Error(`Unknown action: ${action}`);

  record.human_decision = {
    action,
    approval_status: change.approval_status,
    current_assignee: change.current_assignee ?? record.triage_result.current_assignee,
    note,
    decided_at: new Date().toISOString()
  };
  return saveRecord(record, resultsDir);
}

/* ---------- validate → triage → evaluate ---------- */

/**
 * Processes exactly one RFI: validates it and its linked daily reports,
 * triages it with one LLM call, then evaluates the result against the answer key.
 */
export async function processRfi(rfi, {
  key = recordKey(rfi, "unknown"),
  dailyReportPool = loadDailyReportPool(),
  triage,
  answerKey = loadAnswerKey(),
  resultsDir = RESULTS_DIR
} = {}) {
  const base = { key, rfi, processed_at: new Date().toISOString() };
  const validation = validateRfi(rfi, dailyReportPool);
  const { dailyReports, ...validationSummary } = validation;

  if (!validation.valid) {
    return saveRecord({ ...base, status: "invalid", daily_reports: dailyReports, validation: validationSummary }, resultsDir);
  }

  try {
    triage ??= (await import("./triage.js")).triageRfi;
    const { prompt, raw, result } = await triage(rfi, dailyReports);
    return saveRecord({
      ...base,
      status: "triaged",
      daily_reports: dailyReports,
      validation: validationSummary,
      prompt,
      raw_model_output: raw,
      triage_result: result,
      evaluation: evaluateResult(result, answerKey),
      human_decision: null
    }, resultsDir);
  } catch (error) {
    return saveRecord({
      ...base,
      status: "error",
      daily_reports: dailyReports,
      validation: validationSummary,
      error: error.message
    }, resultsDir);
  }
}

/** Processes RFIs strictly one at a time, in order. */
export async function processQueue(rfis, options = {}, onResult = () => {}) {
  const records = [];
  for (const [index, rfi] of rfis.entries()) {
    const key = recordKey(rfi, `upload-${Date.now()}-${index + 1}`);
    const record = await processRfi(rfi, { ...options, key });
    records.push(record);
    onResult(record);
  }
  return records;
}
