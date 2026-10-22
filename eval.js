import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_PATH = path.join(
  __dirname,
  "data",
  "synthetic",
  "samples.json"
);
const RESULTS_DIR = path.join(__dirname, "results");


const FLAG_TO_LABELS = {
  missing_information: ["INCOMPLETE"],
  possible_duplicate: ["RELATED_OR_DUPLICATE"],
  confirmed_duplicate: ["RELATED_OR_DUPLICATE"],
  drawing_conflict: ["POSSIBLE_CONFLICT"],
  unverified_attachment: ["UNVERIFIED_ATTACHMENT"],
  contract_risk: ["CONTRACT_RISK"],
  unclear_question: ["UNCLEAR_QUESTION"],
  missing_location: ["MISSING_LOCATION"],
  missing_drawing_reference: ["MISSING_DRAWING_REFERENCE"],
  missing_spec_reference: ["MISSING_SPEC_REFERENCE"],
  missing_supporting_documentation: ["INCOMPLETE"]
};


const ISSUE_LABELS = new Set(
  Object.values(FLAG_TO_LABELS).flat()
);


function normalize(value) {
  return String(value).trim().toUpperCase();
}


function uniqueNormalized(values) {
  if (!Array.isArray(values)) {
    throw new Error("Expected labels and flags must be arrays");
  }


  return [...new Set(values.map(normalize))];
}


function getOutputRecord(resultFile, filePath) {
  if (!resultFile || typeof resultFile !== "object" || Array.isArray(resultFile)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  if (resultFile.status === "error") {
    return { error: resultFile.error ?? "Agent run failed" };
  }


  const output = resultFile.triage_result ?? resultFile.result ?? resultFile;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error(`${filePath} does not contain an agent result object`);
  }


  return { output };
}


function getPredictedLabels(output) {
  if (Array.isArray(output.labels)) {
    return uniqueNormalized(output.labels);
  }
  if (!Array.isArray(output.flags)) {
    throw new Error(`Agent result ${output.item_id ?? ""} has no labels or flags`);
  }


  const labels = output.flags.flatMap((flag) => {
    const normalizedFlag = normalize(flag).toLowerCase();
    return FLAG_TO_LABELS[normalizedFlag] ?? [];
  });
  return uniqueNormalized(labels);
}


function deriveRouteDecision(labels) {
  if (
    labels.includes("POSSIBLE_CONFLICT") ||
    labels.includes("RELATED_OR_DUPLICATE")
  ) {
    return "REVIEW";
  }
  if (
    labels.some((label) =>
      [
        "INCOMPLETE",
        "MISSING_LOCATION",
        "MISSING_DRAWING_REFERENCE",
        "MISSING_SPEC_REFERENCE",
        "UNCLEAR_QUESTION"
      ].includes(label)
    )
  ) {
    return "REVISE";
  }
  return "ROUTE";
}


function compareSample(sample, resultEntry) {
  const expectedLabels = uniqueNormalized(sample.expected_labels);
  const expectedIssues = expectedLabels.filter(
    (label) => label !== "READY" && label !== "NEEDS_HUMAN_REVIEW"
  );


  if (resultEntry.error) {
    return {
      item_id: sample.item_id,
      classification: ["Missed"],
      caught: [],
      missed: expectedIssues,
      false_flags: [],
      expected_route_decision: normalize(sample.expected_route_decision),
      actual_route_decision: null,
      route_match: false,
      error: resultEntry.error
    };
  }


  const output = resultEntry.output;
  const predictedLabels = getPredictedLabels(output);
  const predictedIssues = predictedLabels.filter(
    (label) => label !== "READY" && label !== "NEEDS_HUMAN_REVIEW"
  );
  const expectedIssueSet = new Set(expectedIssues);
  const predictedIssueSet = new Set(predictedIssues);
  const caught = expectedIssues.filter((label) => predictedIssueSet.has(label));
  const missed = expectedIssues.filter((label) => !predictedIssueSet.has(label));
  const falseFlags = predictedIssues.filter((label) => !expectedIssueSet.has(label));
  const expectedRoute = normalize(sample.expected_route_decision);
  const actualRoute = output.route_decision == null
    ? output.routeDecision == null
      ? deriveRouteDecision(predictedLabels)
      : normalize(output.routeDecision)
    : normalize(output.route_decision);


  let classification;
  if (expectedLabels.includes("READY") && falseFlags.length === 0) {
    classification = ["Correct Pass"];
  } else {
    classification = [];
    if (caught.length > 0) classification.push("Caught");
    if (missed.length > 0) classification.push("Missed");
    if (falseFlags.length > 0) classification.push("False Flag");
    if (classification.length === 0) classification.push("Correct Pass");
  }


  return {
    item_id: sample.item_id,
    classification,
    caught,
    missed,
    false_flags: falseFlags,
    expected_route_decision: expectedRoute,
    actual_route_decision: actualRoute,
    route_match: expectedRoute === actualRoute
  };
}


function loadResults(resultsDir) {
  if (!fs.existsSync(resultsDir)) {
    throw new Error(`Results directory not found: ${resultsDir}`);
  }


  const entries = new Map();
  for (const fileName of fs.readdirSync(resultsDir).filter((name) => name.endsWith(".json"))) {
    const filePath = path.join(resultsDir, fileName);
    const resultFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const { output, error } = getOutputRecord(resultFile, filePath);
    const fileItemId = fileName.replace(/_results\.json$/i, "");
    const itemId = output?.item_id ?? fileItemId;


    if (output?.item_id && normalize(output.item_id) !== normalize(fileItemId)) {
      throw new Error(
        `${fileName} contains item_id ${output.item_id}, which does not match its filename`
      );
    }
    const normalizedId = normalize(itemId);
    if (entries.has(normalizedId)) {
      throw new Error(`Multiple result files found for ${itemId}`);
    }
    entries.set(normalizedId, { output, error, fileName });
  }
  return entries;
}


function getRowStatus(row) {
  if (row.error) return "ERROR";
  if (row.classification.includes("Correct Pass")) return "PASS";
  if (row.classification.includes("Missed")) return "MISS";
  if (row.classification.includes("False Flag")) return "FALSE FLAG";
  return "REVIEW";
}


function formatList(values) {
  return values.length ? values.join(", ") : "—";
}


function formatRoute(row) {
  const expected = row.expected_route_decision || "—";
  const actual = row.actual_route_decision || "—";
  const mismatchMarker = row.route_match ? "" : " ✗";
  return `${expected} / ${actual}${mismatchMarker}`;
}


function printResults(report) {
  const header =
    "ITEM".padEnd(12) +
    "STATUS".padEnd(12) +
    "CAUGHT".padEnd(30) +
    "MISSED".padEnd(30) +
    "FALSE FLAGS".padEnd(30) +
    "ROUTE (EXPECTED / ACTUAL)";


  console.log(`\n${header}`);
  console.log("-".repeat(header.length));


  for (const row of report) {
    console.log(
      row.item_id.padEnd(12) +
        getRowStatus(row).padEnd(12) +
        formatList(row.caught).padEnd(30) +
        formatList(row.missed).padEnd(30) +
        formatList(row.false_flags).padEnd(30) +
        formatRoute(row)
    );


    if (row.error) {
      console.error(`  ↳ ${row.error}`);
    }
  }
}


function printSummary(report, unmatchedResults) {
  const routeMismatches = report.filter((row) => !row.route_match);
  const passed = report.filter((row) =>
    row.classification.includes("Correct Pass")
  ).length;
  const missed = report.filter((row) => row.missed.length > 0).length;
  const falseFlagged = report.filter((row) => row.false_flags.length > 0).length;
  const errors = report.filter((row) => row.error).length;


  console.log("\nSummary");
  console.log("-------");
  console.log(`Samples evaluated:   ${report.length}`);
  console.log(`Passed:              ${passed}`);
  console.log(`With missed issues:  ${missed}`);
  console.log(`With false flags:    ${falseFlagged}`);
  console.log(`Route mismatches:    ${routeMismatches.length}`);
  console.log(`Unmatched results:   ${unmatchedResults.length}`);
  console.log(`Errors:              ${errors}`);
}


export function evaluate(samplesPath = SAMPLES_PATH, resultsDir = RESULTS_DIR) {
  const samples = JSON.parse(fs.readFileSync(samplesPath, "utf8"));
  if (!Array.isArray(samples)) {
    throw new Error(`${samplesPath} must contain a JSON array`);
  }


  const results = loadResults(resultsDir);
  const sampleIds = new Set();
  const report = samples.map((sample) => {
    if (!sample.item_id) {
      throw new Error("Every sample must have an item_id");
    }
    const id = normalize(sample.item_id);
    if (sampleIds.has(id)) {
      throw new Error(`Duplicate sample item_id: ${sample.item_id}`);
    }
    sampleIds.add(id);


    const result = results.get(id);
    if (!result) {
      return compareSample(sample, { error: "No matching result file" });
    }
    return compareSample(sample, result);
  });


  const unmatchedResults = [...results.keys()].filter((id) => !sampleIds.has(id));
  for (const itemId of unmatchedResults) {
    console.error(`Unmatched result file: ${results.get(itemId).fileName}`);
  }


  printResults(report);
  printSummary(report, unmatchedResults);


  const routeMismatches = report.filter((row) => !row.route_match);
  const failed = report.some((row) => row.error) ||
    unmatchedResults.length > 0 ||
    routeMismatches.length > 0 ||
    report.some((row) => row.missed.length > 0 || row.false_flags.length > 0);


  if (failed) process.exitCode = 1;
  return report;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  evaluate();
}