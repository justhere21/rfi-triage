import { readFileSync } from "node:fs";

const ANSWER_KEY_URL = new URL("../data/answers/draft-answer-key.json", import.meta.url);

export function loadAnswerKey(url = ANSWER_KEY_URL) {
  const { cases = [] } = JSON.parse(readFileSync(url, "utf8"));
  return new Map(cases.map((entry) => [entry.rfi_id, entry]));
}

/**
 * Compares one triage result against its answer-key case.
 * Uses the evaluation-design terms: Caught, Missed, False Flag, Correct Pass.
 */
export function evaluateResult(triageResult, answerKey = loadAnswerKey()) {
  const expected = answerKey.get(triageResult.rfi_id);
  if (!expected) {
    return { status: "no_answer_key" };
  }

  const expectedTypes = [...new Set(expected.expected_conflict_types)];
  const actualTypes = [
    ...new Set(triageResult.flagged_conflicts.map((conflict) => conflict.conflict_type))
  ];
  const caught = expectedTypes.filter((type) => actualTypes.includes(type));
  const missed = expectedTypes.filter((type) => !actualTypes.includes(type));
  const falseFlags = actualTypes.filter((type) => !expectedTypes.includes(type));

  // Approval gatekeeper: an RFI with expected conflicts or open clarification
  // must not be auto-approved.
  const mustBlock = expectedTypes.length > 0 || expected.requires_clarification;
  const gateViolation = mustBlock && triageResult.approval_status === "Approved";

  let classification;
  if (expectedTypes.length === 0 && falseFlags.length === 0) {
    classification = ["Correct Pass"];
  } else {
    classification = [];
    if (caught.length) classification.push("Caught");
    if (missed.length) classification.push("Missed");
    if (falseFlags.length) classification.push("False Flag");
  }

  return {
    status: "evaluated",
    classification,
    expected_conflict_types: expectedTypes,
    caught,
    missed,
    false_flags: falseFlags,
    requires_clarification: expected.requires_clarification,
    gate_violation: gateViolation,
    passed: missed.length === 0 && falseFlags.length === 0 && !gateViolation,
    rationale: expected.rationale
  };
}
