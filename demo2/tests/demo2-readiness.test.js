import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ROOT } from "../scripts/lib/demo2-data.js";
import { inspectApplication, checkDocumentLinks, buildReadinessReport, runReadinessCheck } from "../scripts/check-demo2-readiness.js";

test("UI notes and data commands cannot establish an executable or deployed application", () => {
  const report = inspectApplication(["ui_prompts.md"], { "prepare-demo2": "node scripts/prepare-demo2.js", test: "node --test" });
  assert.equal(report.deployment_status, "blocked");
  assert.deepEqual(report.source_files, []);
  assert.deepEqual(report.inventory_blockers, ["demo2_application_source_missing", "application_start_command_missing"]);
  assert.equal(report.endpoints_tested, false);
  assert.equal(report.deployment_tested, false);
});

test("even application source and a launch script stay unverified until runtime evidence exists", () => {
  const report = inspectApplication(["server.js", "server.test.js"], { start: "node server.js" });
  assert.equal(report.deployment_status, "unverified");
  assert.deepEqual(report.source_files, ["server.js"]);
  assert.equal(report.runtime_tested, false);
  assert.equal(report.build_script, null);
});

test("local documentation checks detect missing targets without asserting remote access", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo2-doc-links-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "guide.md"), "[Local](target.md) [Remote](https://example.com/private) [Anchor](#check)\n");
  const missing = checkDocumentLinks(directory, ["guide.md"]);
  assert.equal(missing.valid, false);
  assert.equal(missing.errors[0].code, "missing_document_link");
  fs.writeFileSync(path.join(directory, "target.md"), "# Target\n");
  const valid = checkDocumentLinks(directory, ["guide.md"]);
  assert.equal(valid.valid, true);
  assert.equal(valid.external_access_checked, false);
  assert.equal(checkDocumentLinks(directory, ["absent.md"]).errors[0].code, "missing_document");
});

test("the actual readiness audit keeps offline success separate from blocked imports and application gaps", () => {
  const report = buildReadinessReport();
  assert.equal(report.offline_checks_passed, true);
  assert.equal(report.synthetic_batch.counts.model_inputs, 5);
  assert.equal(report.team_source_audit.blocked_records, 10);
  assert.equal(report.team_source_audit.ready_inputs, 0);
  assert.equal(report.application.deployment_status, "blocked");
  assert.equal(runReadinessCheck(["--unknown"], { logger: { log() {}, error() {} } }).exitCode, 1);
});

test("readiness CLI runs without credentials from another directory and creates no files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo2-readiness-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(ROOT, "demo2/data/synthetic");
  const before = fs.readFileSync(source);
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts/check-demo2-readiness.js")], {
    cwd: directory, encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "", OPENAI_API_KEY: "" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).application.deployment_status, "blocked");
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.deepEqual(fs.readFileSync(source), before);
});
