# Demo 2 data preparation and compatibility

Two separate Demo 2 batches are retained here. The team's [`synthetic`](synthetic) file contains 10 `TC-01`–`TC-10` source rows added in commit `4764713`; its compatibility audit currently produces **zero ready inputs and 10 blocked rows**. The five `SYN2` fixtures described below are a separate offline smoke batch. They are not a combined, accepted 15-case evaluation set.

Both batches are separate from the [17-ID public collection](../../data/public-rfi/README.md) and the [23-record Demo 1 primary synthetic collection](../../data/synthetic/README.md). Project names in the TC rows do not verify real events or histories from those public projects.

## Team TC source: audit before integration

Run from the repository root:

```sh
npm ci
npm run prepare-demo2-team
npm run validate-demo2-team
```

`prepare-demo2-team` preserves the raw source and writes deterministic compatibility artifacts under `prepared/team-tc/`. `validate-demo2-team` runs the same audit with `--check`, compares the expected artifact bytes with the saved files, and writes nothing. A successful command means the compatibility audit is reproducible; it does not mean that the 10 rows are valid, ready RFI inputs.

| Path | Role |
| --- | --- |
| [`synthetic`](synthetic) | Original 10-row source, preserved without edits. |
| [`prepared/team-tc/compatibility-report.json`](prepared/team-tc/compatibility-report.json) | Per-row field gaps, vocabulary checks, and blocked/ready counts. |
| [`prepared/team-tc/candidate-rfis.json`](prepared/team-tc/candidate-rfis.json) | Partial candidates from conservative field mapping; these are not model inputs. |
| [`prepared/team-tc/source-annotations.json`](prepared/team-tc/source-annotations.json) | Raw `assignee`, `status`, and `conflict` annotations, separated pending clarification of their meaning. |
| [`prepared/team-tc/ready-inputs.json`](prepared/team-tc/ready-inputs.json) | Ready canonical inputs only; currently an empty array. |
| [`prepared/team-tc/manifest.json`](prepared/team-tc/manifest.json) | Source/schema paths and full SHA-256 hashes for traceability. |

Only `id → rfi_id`, `topic → title`, and the supplied `description` are mapped into partial RFI candidates. The source project text is retained as `source_project_name`, not promoted to an invented `project_id`. All 10 rows lack `project_id`, `submitted_by`, `date_submitted`, and an explicit `linked_daily_report_ids` list. No dates, submitters, reports, or empty link lists are manufactured to satisfy the schema.

The source annotations are not a final answer key or model input. Their current-state versus expected-answer meaning and any vocabulary mapping require team agreement. See the [TC compatibility note](../docs/team-tc-compatibility.md) for all 10 rows and the explicit information needed before integration. The existing schemas and evaluation design remain unchanged.

## Separate SYN2 smoke batch

This directory holds **five entirely fictional smoke cases**, identified by `dataset_id: demo2-synthetic-smoke-v1`, `provenance: synthetic`, and `SYN2` case IDs. They cover a consistent RFI/report pair, schedule discrepancy, labor discrepancy, scope discrepancy, and insufficient linked-report context. Dates, people, project details, work statements, and links in these fixtures are scenario content rather than observed project facts.

These new cases were drafted with coding-assistant support for team review. They have not been accepted as the team's final evaluation cases.

The preparation commands below do not modify or combine the TC source or the earlier collections.

### SYN2 files and boundaries

| Path | Role |
| --- | --- |
| [`source/synthetic-cases.json`](source/synthetic-cases.json) | Explicit source scenarios: canonical RFI fields and authored daily reports where supplied. |
| [`answers/draft-answer-key.json`](answers/draft-answer-key.json) | Proposed answers, all draft and pending team review. Never part of model input. |
| [`prepared/synthetic/rfis.json`](prepared/synthetic/rfis.json) | Prepared RFI array. |
| [`prepared/synthetic/daily-reports.json`](prepared/synthetic/daily-reports.json) | Prepared daily-report array. |
| [`prepared/synthetic/model-inputs.json`](prepared/synthetic/model-inputs.json) | Model-input array; each item contains only `rfi` and its explicitly linked `daily_reports`. |
| [`prepared/synthetic/manifest.json`](prepared/synthetic/manifest.json) | Source/schema hashes, relative paths, source pointers, links, and counts. |
| [`prepared/synthetic/validation-report.json`](prepared/synthetic/validation-report.json) | Offline preparation checks and preserved-context warnings. |

The source remains distinct from derived artifacts. The preparation pipeline never reads the draft answer key or adds expected conflicts, expected decisions, or evaluation labels to model inputs. The key requires separate human review before any scoring work.

### Prepare and verify SYN2

Run from the repository root:

```sh
npm ci
npm run prepare-demo2
npm run validate-demo2
```

`prepare-demo2` reads the explicit source fields, validates and separates the linked records, and writes the five files under `prepared/synthetic/`. It adds no invented metadata defaults and makes no model or API calls. The same source and schema files produce the same prepared bytes; the manifest uses repository-relative paths and SHA-256 hashes without generated dates.

`validate-demo2` reconstructs all five expected artifacts in memory and compares them byte-for-byte with the prepared files. It writes nothing. Run preparation first when the artifacts are absent or intentionally need regeneration. Source changes should be reviewed before regenerating the handoff.

After an application run has produced a separate JSON array of triage results, its output contract can optionally be checked with:

```sh
npm run validate-demo2 -- --outputs path/to/results.json
```

Replace the path with the actual results file. No model-output file is supplied by this batch. This optional check validates output shape, allowed fields and enums, unique RFI IDs, and exact coverage of the prepared cases. It does not score answer correctness or prove approval enforcement.

### What SYN2 validation means

- The existing [RFI schema](../schemas/rfi_schema.json) checks RFI shape. The supplemental [daily-report schema](../schemas/daily_report_schema.json) is a provisional integration contract.
- Relationship checks use explicit report IDs and project identity; they do not infer a link from similar wording.
- Schema-valid empty arrays remain empty. The missing-report case records a `preserved_missing_context` warning rather than inventing context or failing preparation.
- The manifest traces each RFI to a source pointer such as `/cases/0` and records its supplied report IDs. It also records the source file, schema files, their hashes, and counts.
- A successful offline check establishes a reproducible input batch and structural conformity. It does not establish complete project context, correct draft answers, model performance, or a functioning application.

## Integration decisions still open

The [evaluation design](../docs/evaluation-design.md) uses workflow stages that differ from the [triage-output schema](../schemas/triage_output_schema.json). These files remain unchanged; status alignment is still a team decision. The supplemental daily-report contract is also provisional.

The RFI inputs do not contain current workflow state or human approval-event history. The five SYN2 cases can support discrepancy smoke checks and preserve a missing-context condition; they cannot establish status accuracy, reviewer ownership, an enforced approval gate, or final readiness. A consistent RFI/report pair is only a negative discrepancy example, not proof that a case is ready for approval. The TC compatibility audit establishes the source's gaps without supplying the missing workflow evidence.

See the [Demo 2 data justification](../docs/data-justification.md) for provenance, limited field correspondences with the earlier schema, and evaluation limits. This offline data handoff does not claim a model, app, API, or deployment run, and supplies no accuracy or time-saving results.
