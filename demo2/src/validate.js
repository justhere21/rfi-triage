import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const loadSchema = (name) =>
  JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"));

const rfiSchema = loadSchema("rfi_schema.json");
const dailyReportSchema = loadSchema("daily_report_schema.json");
const outputSchema = loadSchema("triage_output_schema.json");

export const validateRfiSchema = ajv.compile(rfiSchema);
export const validateDailyReportSchema = ajv.compile(dailyReportSchema);
export const validateOutput = ajv.compile(outputSchema);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function schemaErrors(validator, record) {
  if (validator(record)) return [];
  return validator.errors.map((error) => ({
    code: "schema",
    field: error.instancePath || error.params?.missingProperty || "",
    message: error.message
  }));
}

function blankRequiredFields(record, schema) {
  if (!isObject(record)) return [];
  return (schema.required ?? [])
    .filter((key) => typeof record[key] === "string" && !record[key].trim())
    .map((key) => ({ code: "blank_required_field", field: key, message: "must not be blank" }));
}

function unexpectedFields(record, schema) {
  if (!isObject(record)) return [];
  return Object.keys(record)
    .filter((key) => !Object.hasOwn(schema.properties, key))
    .map((key) => ({ code: "unexpected_field", field: key, message: "is not defined in the schema" }));
}

export function validateDailyReport(report) {
  const errors = [
    ...schemaErrors(validateDailyReportSchema, report),
    ...blankRequiredFields(report, dailyReportSchema)
  ];
  return { valid: errors.length === 0, errors };
}

/**
 * Validates one RFI against rfi_schema.json and resolves its linked daily
 * reports from the pool, validating each against daily_report_schema.json.
 */
export function validateRfi(rfi, dailyReportPool = []) {
  const errors = [
    ...schemaErrors(validateRfiSchema, rfi),
    ...blankRequiredFields(rfi, rfiSchema),
    ...unexpectedFields(rfi, rfiSchema)
  ];
  const warnings = [];
  const dailyReports = [];

  const links = Array.isArray(rfi?.linked_daily_report_ids) ? rfi.linked_daily_report_ids : [];
  if (Array.isArray(rfi?.linked_daily_report_ids) && links.length === 0) {
    warnings.push({
      code: "no_linked_report",
      message: "No daily report is linked. Schema validity does not establish completeness or approval readiness."
    });
  }

  const pool = new Map(dailyReportPool.map((report) => [report?.report_id, report]));
  const seen = new Set();
  for (const reportId of links) {
    if (seen.has(reportId)) {
      errors.push({ code: "duplicate_link", field: reportId, message: "linked more than once" });
      continue;
    }
    seen.add(reportId);

    const report = pool.get(reportId);
    if (!report) {
      errors.push({ code: "unresolved_report", field: reportId, message: "linked daily report was not found" });
      continue;
    }

    const reportCheck = validateDailyReport(report);
    for (const error of reportCheck.errors) {
      errors.push({ ...error, field: `${reportId}${error.field}` });
    }
    if (report.project_id !== rfi.project_id) {
      errors.push({ code: "cross_project_report", field: reportId, message: "daily report belongs to a different project" });
    }
    if (typeof report.report_date === "string" && typeof rfi.date_submitted === "string" &&
        report.report_date > rfi.date_submitted) {
      warnings.push({
        code: "later_report_context",
        field: reportId,
        message: "The report postdates submission; establish the review time before using it as evidence."
      });
    }
    dailyReports.push(report);
  }

  return { valid: errors.length === 0, errors, warnings, dailyReports };
}

export function assertValidOutput(output, rfiId) {
  if (!validateOutput(output)) {
    throw new Error(
      `Output validation failed for ${rfiId}:\n` +
        JSON.stringify(validateOutput.errors, null, 2)
    );
  }
  if (output.rfi_id !== rfiId) {
    throw new Error(`LLM output rfi_id "${output.rfi_id}" does not match input "${rfiId}"`);
  }
}
