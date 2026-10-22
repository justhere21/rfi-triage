import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DEFAULT_INPUT, loadPreparedItems, parseInputArgs, runInputCheck } from "../scripts/check-input.js";
import { checkItems } from "../scripts/lib/check-items.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const silent = { log() {}, error() {} };
const validItem = (id = "FICTIONAL-001", changes = {}) => ({
  item_id: id, item_type: "rfi", provenance: "synthetic", submitted_date: "2026-03-09",
  submitted_by: "Fictional offline test", discipline: "A", location: "Test room",
  question_text: "Fictional test request: please confirm the detail.",
  drawing_refs: [], spec_refs: [], attachments: [], related_item_ids: [], ...changes
});

function fixture(t, contents = [validItem()]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rfi-input-check-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "items.json");
  fs.writeFileSync(input, JSON.stringify(contents, null, 2) + "\n");
  return { directory, input };
}

test("standalone checker reads the 23 prepared cases with separate source answers", () => {
  const items = loadPreparedItems();
  assert.equal(items.length, 23);
  assert.equal(items.filter((item) => item.item_type === "rfi").length, 15);
  assert.equal(items.filter((item) => item.item_type === "email").length, 4);
  assert.equal(items.filter((item) => item.item_type === "minutes").length, 4);
  for (const item of items) {
    assert.equal(item.provenance, "synthetic");
    assert.ok(!Object.keys(item).some((field) => /expected|answer|label|true_|notes/.test(field)));
  }
  assert.equal(runInputCheck([], { logger: silent }).validatedCount, 23);
});

test("local data schema preserves optional source version evidence and validates its type", (t) => {
  const item = validItem("FICTIONAL-001", { current_drawing_version: "TEST-A1 Revision 2" });
  const files = fixture(t, [item]);
  assert.deepEqual(loadPreparedItems(files.input), [item]);
  for (const current_drawing_version of [1, null, {}, []]) {
    fs.writeFileSync(files.input, JSON.stringify([{ ...item, current_drawing_version }]));
    assert.throws(() => loadPreparedItems(files.input), /current_drawing_version/);
  }
});

test("explicit provenance checks support separate partner and observed public batches", (t) => {
  const files = fixture(t, [validItem("FICTIONAL-001", { provenance: "partner" })]);
  assert.throws(() => loadPreparedItems(files.input), /mixed_provenance/);
  assert.equal(loadPreparedItems(files.input, { provenance: "partner" }).length, 1);
  assert.equal(runInputCheck(["--input", files.input, "--provenance", "partner"], { logger: silent }).exitCode, 0);
  fs.writeFileSync(files.input, JSON.stringify([validItem("FICTIONAL-001", { provenance: "observed_public" })]));
  assert.equal(loadPreparedItems(files.input, { provenance: "observed_public" }).length, 1);
  assert.throws(() => loadPreparedItems(files.input, { provenance: "invented" }), /Unknown provenance/);
});

test("input validation rejects malformed shapes, missing fields, blank questions, impossible dates and mixed provenance", (t) => {
  const files = fixture(t);
  const missing = validItem();
  delete missing.drawing_refs;
  const batches = [
    {}, [], [null], [missing], [validItem("FICTIONAL-001", { question_text: "  " })],
    [validItem("FICTIONAL-001", { submitted_date: "2026-02-30" })],
    [validItem(), validItem("FICTIONAL-002", { provenance: "partner" })]
  ];
  for (const batch of batches) {
    fs.writeFileSync(files.input, JSON.stringify(batch));
    assert.throws(() => loadPreparedItems(files.input), /Input validation failed/);
  }
});

test("input checks reject unsafe, repeated and case-colliding IDs and unresolved or self references", (t) => {
  const files = fixture(t);
  const batches = [
    [validItem("../outside")], [validItem("A/B")], [validItem("A\\B")],
    [validItem(), validItem()], [validItem("CASE"), validItem("case")],
    [validItem("FICTIONAL-001", { related_item_ids: ["ABSENT"] })],
    [validItem("FICTIONAL-001", { related_item_ids: ["FICTIONAL-001"] })]
  ];
  for (const batch of batches) {
    fs.writeFileSync(files.input, JSON.stringify(batch));
    assert.throws(() => loadPreparedItems(files.input), /unsafe_id|duplicate_id|unresolved_relation|self_relation/);
  }
  const linked = [validItem("ONE", { related_item_ids: ["TWO"] }), validItem("TWO")];
  fs.writeFileSync(files.input, JSON.stringify(linked));
  assert.deepEqual(loadPreparedItems(files.input), linked);
});

test("answer leakage and unknown source fields are rejected before downstream loading", (t) => {
  const files = fixture(t);
  for (const field of ["expected_labels", "true_needs_response", "notes", "answer_key", "unrecognized"]) {
    fs.writeFileSync(files.input, JSON.stringify([validItem("FICTIONAL-001", { [field]: "SECRET_ANSWER" })]));
    assert.throws(() => loadPreparedItems(files.input), /unexpected_input_field/);
  }
});

test("malformed or missing files and unknown CLI flags fail clearly without output writes", (t) => {
  const files = fixture(t);
  fs.writeFileSync(files.input, "[broken");
  assert.throws(() => loadPreparedItems(files.input), /Cannot read prepared input/);
  assert.throws(() => loadPreparedItems(path.join(files.directory, "absent.json")), /Cannot read prepared input/);
  assert.equal(runInputCheck(["--input", files.input], { logger: silent }).exitCode, 1);
  for (const args of [["--dry-run"], ["--results-dir", "out"], ["--input"], ["--provenance"], ["--provenance", "other"]]) {
    assert.throws(() => parseInputArgs(args), /Unknown argument|requires a value|Unknown provenance/);
    assert.equal(runInputCheck(args, { logger: silent }).exitCode, 1);
  }
  assert.deepEqual(fs.readdirSync(files.directory), ["items.json"]);
  assert.equal(fs.readFileSync(files.input, "utf8"), "[broken");
  assert.equal(parseInputArgs([]).input, DEFAULT_INPUT);
  assert.equal(runInputCheck(["--help"], { logger: silent }).exitCode, 0);
});

test("CLI runs offline from another directory, preserves source bytes and creates no results", (t) => {
  const files = fixture(t, [validItem("FICTIONAL-001", { provenance: "partner" })]);
  const before = fs.readFileSync(files.input);
  const command = path.join(root, "scripts/check-input.js");
  const env = { ...process.env, GEMINI_API_KEY: "", GEMINI_MODEL: "" };
  const valid = spawnSync(process.execPath, [command, "--input", files.input, "--provenance", "partner"], { cwd: files.directory, env, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Validated 1 partner inputs/);
  assert.deepEqual(fs.readFileSync(files.input), before);
  assert.deepEqual(fs.readdirSync(files.directory), ["items.json"]);
  const invalid = spawnSync(process.execPath, [command, "--input", files.input], { cwd: files.directory, env, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /mixed_provenance/);
  assert.deepEqual(fs.readFileSync(files.input), before);
  const defaults = spawnSync(process.execPath, [command], { cwd: files.directory, env, encoding: "utf8" });
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.match(defaults.stdout, /Validated 23 synthetic inputs/);
});

test("script validation reports local data-schema errors without runtime dependencies", () => {
  const checked = checkItems([validItem("FICTIONAL-001", { current_drawing_version: false })]);
  assert.ok(checked.errors.some((error) => error.code === "input_schema"));
});
