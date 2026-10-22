import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/csv.js";

export const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PUBLIC_SOURCES = [
  "data/public-rfi/lee-whedon-july3-metadata.csv",
  "data/public-rfi/willis-isd-rfi-metadata.csv"
];
const DAY_MS = 86_400_000;
const DATE_FIELDS = ["received_or_submitted_date_iso", "closed_or_response_date_iso"];
const PRESERVED_FIELDS = [
  "record_ID", "project", "original_ID", "source_page", "source_snapshot_date", "source_url",
  "received_or_submitted_date_raw", "received_or_submitted_date_iso", "received_or_submitted_date_semantics",
  "closed_or_response_date_raw", "closed_or_response_date_iso", "closed_or_response_date_semantics",
  "reported_total_days", "derived_elapsed_calendar_days", "quality_notes"
];
const REQUIRED_FIELDS = PRESERVED_FIELDS.filter((field) => !["original_ID", "source_page", "source_snapshot_date", "source_url", "quality_notes"].includes(field));
const USAGE = "Usage: node scripts/calculate-intervals.js [--check | --out FILE]";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;

function isoMidnight(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a normalized ISO date string or blank`);
  if (!value.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD exactly`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a real calendar date: ${value}`);
  }
  return date.getTime();
}

// Blank means unknown. UTC is a calculation convention, not an observed time.
export function calendarDays(start, end) {
  const from = isoMidnight(start, DATE_FIELDS[0]);
  const to = isoMidnight(end, DATE_FIELDS[1]);
  if (from === null || to === null) return null;
  if (to < from) throw new Error("The close/response date precedes the received/submitted date");
  return (to - from) / DAY_MS;
}

function storedDays(value) {
  if (typeof value !== "string") throw new Error("Stored derived interval must be a nonnegative integer string or blank");
  if (!value.trim()) return null;
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid stored derived interval: ${value}`);
  }
  return Number(value);
}

export function calculateRows(rows, { sourceFile = "input.csv" } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${sourceFile} must contain a nonempty array of records`);
  return rows.map((row, index) => {
    const record = {
      source_file: sourceFile, source_record: index + 1,
      ...Object.fromEntries(PRESERVED_FIELDS.filter((field) => isObject(row) && Object.hasOwn(row, field)).map((field) => [field, row[field]])),
      recomputed_elapsed_calendar_days: null, interval_status: "invalid",
      stored_interval_matches: null, source_quality_notes: [], errors: []
    };
    const issue = (code, message, field) => record.errors.push({ code, ...(field ? { field } : {}), message });
    if (!isObject(row)) {
      issue("invalid_record", "Each source record must be an object");
      return record;
    }
    for (const field of REQUIRED_FIELDS) {
      if (!Object.hasOwn(row, field)) issue("missing_source_field", `Required source field ${field} is absent`, field);
    }
    for (const field of ["record_ID", "project", "received_or_submitted_date_semantics", "closed_or_response_date_semantics"]) {
      if (Object.hasOwn(row, field) && !nonblank(row[field])) issue("invalid_source_field", `${field} must be a nonblank string`, field);
    }
    if (record.errors.length) return record;
    let recomputed;
    try {
      recomputed = calendarDays(row[DATE_FIELDS[0]], row[DATE_FIELDS[1]]);
      record.recomputed_elapsed_calendar_days = recomputed;
      record.interval_status = recomputed === null ? "unknown" : "calculated";
    } catch (error) {
      issue("invalid_date_interval", error.message);
      return record;
    }
    try {
      const stored = storedDays(row.derived_elapsed_calendar_days);
      record.stored_interval_matches = stored === recomputed;
      if (!record.stored_interval_matches) issue("stored_interval_mismatch", `Stored derived interval ${JSON.stringify(row.derived_elapsed_calendar_days)} differs from recomputed ${recomputed === null ? "unknown" : recomputed}`);
    } catch (error) {
      issue("invalid_stored_interval", error.message, "derived_elapsed_calendar_days");
    }
    if (recomputed === null) {
      record.source_quality_notes.push({ code: "missing_normalized_date", message: "At least one normalized source date is blank; interval remains unknown. Raw dates are preserved and are not reparsed or corrected." });
    } else if (row.reported_total_days !== "") {
      const reported = typeof row.reported_total_days === "string" && /^\d+(?:\.\d+)?$/.test(row.reported_total_days)
        ? Number(row.reported_total_days) : NaN;
      if (!Number.isFinite(reported)) {
        record.source_quality_notes.push({ code: "unparsed_reported_duration", message: "Printed reported_total_days is not a nonnegative numeric value; it is preserved without correction." });
      } else if (reported !== recomputed) {
        record.source_quality_notes.push({ code: "reported_duration_difference", message: `Printed reported_total_days ${JSON.stringify(row.reported_total_days)} differs from exclusive calendar-date difference ${recomputed}; both values are preserved.` });
      }
    }
    return record;
  });
}

function counts(records) {
  return {
    records: records.length,
    calculated_records: records.filter((record) => record.interval_status === "calculated").length,
    unknown_records: records.filter((record) => record.interval_status === "unknown").length,
    invalid_interval_records: records.filter((record) => record.interval_status === "invalid").length,
    failed_records: records.filter((record) => record.errors.length).length,
    stored_mismatch_records: records.filter((record) => record.errors.some((error) => error.code === "stored_interval_mismatch")).length,
    reported_difference_records: records.filter((record) => record.source_quality_notes.some((note) => note.code === "reported_duration_difference")).length
  };
}

function projectSummaries(records) {
  const groups = new Map();
  for (const record of records) {
    const key = JSON.stringify([record.project ?? null, record.received_or_submitted_date_semantics ?? null, record.closed_or_response_date_semantics ?? null]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].map((group) => {
    const days = group.filter((record) => record.interval_status === "calculated" && !record.errors.length).map((record) => record.recomputed_elapsed_calendar_days);
    const sum = days.reduce((total, value) => total + value, 0);
    return {
      project: group[0].project ?? null,
      start_date_semantics: group[0].received_or_submitted_date_semantics ?? null,
      end_date_semantics: group[0].closed_or_response_date_semantics ?? null,
      ...counts(group), aggregation_records: days.length,
      sum_calendar_days: days.length ? sum : null,
      min_calendar_days: days.length ? Math.min(...days) : null,
      max_calendar_days: days.length ? Math.max(...days) : null,
      mean_calendar_days: days.length ? Number((sum / days.length).toFixed(6)) : null
    };
  });
}

export function buildIntervalReport({ root = REPO_ROOT, sourceFiles = PUBLIC_SOURCES } = {}) {
  const records = [];
  const sources = [];
  const errors = [];
  if (!Array.isArray(sourceFiles) || !sourceFiles.length) errors.push({ code: "missing_sources", message: "At least one public CSV source is required" });
  for (const file of Array.isArray(sourceFiles) ? sourceFiles : []) {
    let bytes;
    try {
      bytes = fs.readFileSync(path.resolve(root, file));
      const rows = parseCsv(bytes.toString("utf8"), file);
      const calculated = calculateRows(rows, { sourceFile: file });
      records.push(...calculated);
      sources.push({ file, sha256: sha256(bytes), records: rows.length });
    } catch (error) {
      sources.push({ file, sha256: bytes ? sha256(bytes) : null, records: 0 });
      errors.push({ code: "source_error", source_file: file, message: error.message });
    }
  }
  const ids = new Map();
  for (const record of records) {
    if (!nonblank(record.record_ID)) continue;
    const id = record.record_ID.toLowerCase();
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(record);
  }
  for (const duplicates of ids.values()) if (duplicates.length > 1) {
    for (const record of duplicates) record.errors.push({ code: "duplicate_record_id", message: `Repeated record_ID: ${record.record_ID}` });
  }
  const pointer = (record) => ({ source_file: record.source_file, source_record: record.source_record, record_ID: record.record_ID ?? null });
  errors.push(...records.flatMap((record) => record.errors.map((error) => ({ ...pointer(record), ...error }))));
  return {
    report_id: "public-rfi-calendar-intervals-v1", valid: errors.length === 0,
    method: {
      inputs: DATE_FIELDS, unit: "calendar_days", calculation: "(close_or_response_UTC_midnight - received_or_submitted_UTC_midnight) / 86400000",
      inclusivity: "Exclusive date difference; same-day pairs equal zero. No workday or holiday adjustment.",
      missing_dates: "Blank normalized dates remain unknown. Raw dates are preserved, never automatically reparsed or corrected.",
      aggregation: "Separate groups by project and source date semantics. Statistics exclude unknown and failed records; arithmetic means are rounded to six decimals. Overall summary contains counts only.",
      interpretation: "Descriptive prebid/preconstruction source-date intervals, not GC processing time, first-answer time, construction delay, or measured AI benefit. Printed durations and stored derived values remain separate."
    },
    sources, summary: counts(records), projects: projectSummaries(records), records,
    errors,
    warnings: records.flatMap((record) => record.source_quality_notes.map((note) => ({ ...pointer(record), ...note })))
  };
}

export const serializeIntervalReport = (report) => JSON.stringify(report, null, 2) + "\n";

export function parseIntervalArgs(args) {
  const options = { check: false, out: null, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--out") {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error("--out requires a file path");
      if (options.out) throw new Error("--out may be supplied only once");
      options.out = path.resolve(value);
    } else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (options.check && options.out) throw new Error("--check is read-only and cannot be combined with --out");
  return options;
}

function canonicalPath(file) {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  const parent = path.dirname(file);
  return parent === file ? file : path.join(canonicalPath(parent), path.basename(file));
}

function checkOutputPath(out, root) {
  const target = canonicalPath(out).toLowerCase();
  const sourcePaths = PUBLIC_SOURCES.map((file) => canonicalPath(path.resolve(root, file)).toLowerCase());
  if (sourcePaths.includes(target)) throw new Error("Output would overwrite a public source CSV");
  if (path.extname(out).toLowerCase() !== ".json") throw new Error("--out must name a JSON report file ending in .json");
  for (const file of PUBLIC_SOURCES) {
    const sourceDirectory = canonicalPath(path.dirname(path.resolve(root, file))).toLowerCase();
    if (target.startsWith(sourceDirectory + path.sep)) throw new Error("Write reports outside the preserved public source directory");
  }
  try {
    const info = fs.lstatSync(out);
    if (info.isSymbolicLink() || info.nlink > 1) throw new Error("Report output must not be a symlink or shared hard link");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function runIntervalCalculation(args = process.argv.slice(2), { root = REPO_ROOT, logger = console } = {}) {
  try {
    const options = parseIntervalArgs(args);
    if (options.help) { logger.log(USAGE); return { exitCode: 0 }; }
    const report = buildIntervalReport({ root });
    logger.log(`${report.summary.records} public records: ${report.summary.calculated_records} calculated, ${report.summary.unknown_records} unknown, ${report.summary.failed_records} failed, ${report.summary.stored_mismatch_records} stored mismatches.`);
    for (const project of report.projects) logger.log(`${project.project}: ${project.aggregation_records} valid intervals, mean ${project.mean_calendar_days ?? "unknown"} calendar days; ${project.unknown_records} unknown. ${project.start_date_semantics} → ${project.end_date_semantics}.`);
    logger.log(`${report.summary.reported_difference_records} printed-duration differences retained as source-quality warnings. These are descriptive date intervals, not GC delay or AI benefit.`);
    if (!report.valid) {
      logger.error(JSON.stringify(report.errors, null, 2));
      return { exitCode: 1, report };
    }
    if (options.out) {
      checkOutputPath(options.out, root);
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, serializeIntervalReport(report));
      logger.log(`Wrote interval report: ${options.out}`);
    } else logger.log("Stored intervals verified. No files were changed.");
    return { exitCode: 0, report, output: options.out };
  } catch (error) {
    logger.error(error.message);
    return { exitCode: 1 };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runIntervalCalculation().exitCode;
}
