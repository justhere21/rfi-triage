# Team TC source compatibility

Updated October 21, 2026. This note describes the offline compatibility audit of the 10 team source rows in [`demo2/data/synthetic`](../data/synthetic), introduced in commit `4764713`. The original file is preserved. Its project labels do not verify real project events, routing histories, or approval decisions.

The current result is **10 audited rows, zero ready inputs, and 10 blocked rows**. This is a completed compatibility audit, not 10 validated canonical RFIs. The separate [five SYN2 smoke fixtures](../data/README.md#separate-syn2-smoke-batch) remain independent; the two batches are not an accepted 15-case evaluation set.

## Conservative field mapping

| Source field | Prepared location | Treatment |
| --- | --- | --- |
| `id` | Candidate `rfi_id` | Preserve the supplied TC identity. |
| `topic` | Candidate `title` | Preserve the supplied topic. |
| `description` | Candidate `description` | Preserve the supplied text. |
| `project` | Source annotations' `source_project_name` | Preserve as source text; no project ID is invented. |
| `assignee`, `status`, `conflict` | Separate source annotations | Preserve raw values; their current-state versus expected-answer meaning is unresolved. |

Every candidate lacks four fields required by the existing [RFI schema](../schemas/rfi_schema.json): `project_id`, `submitted_by`, `date_submitted`, and `linked_daily_report_ids`. The source also supplies no daily-report records. The preparation script does not fill these gaps with an assumed project code, unknown submitter, today's date, or `[]`.

## Row-level findings

All rows below have the same four missing required fields listed above and are blocked from ready input. Status and conflict strings are reproduced as source annotations, not accepted answers.

| ID | Topic | Source status | Source conflict | Input readiness |
| --- | --- | --- | --- | --- |
| `TC-01` | Roof Steel Beams | `Closed` | `None` | Blocked: four required fields absent |
| `TC-02` | Window Glass Type | `Closed` | `Document Mismatch` | Blocked: four required fields absent |
| `TC-03` | Fire Alarm Box | `Closed` | `Safety Rule Issue` | Blocked: four required fields absent |
| `TC-04` | Drain Pipe Swap | `Rejected` | `Unauthorize Change` | Blocked: four required fields absent |
| `TC-05` | Ceiling Pipe Clash | `Closed` | `Space Clash` | Blocked: four required fields absent |
| `TC-06` | Brick Glue Color | `Closed` | `None` | Blocked: four required fields absent |
| `TC-07` | Emergency Lights | `Closed` | `None` | Blocked: four required fields absent |
| `TC-08` | Bathroom Wall Bars | `Closed` | `Rule Compliance` | Blocked: four required fields absent |
| `TC-09` | Rain Drain Height | `In Review` | `Height Mismatch` | Blocked: four required fields absent |
| `TC-10` | Wall Sound Panels | `Closed` | `None` | Blocked: four required fields absent |

The machine-readable [compatibility report](../data/prepared/team-tc/compatibility-report.json) retains each row's specific gaps and vocabulary checks.

## Annotation decisions still needed

The existing [triage-output schema](../schemas/triage_output_schema.json) allows statuses `Draft`, `Pending Review`, `Conflict Flagged`, `Approved`, and `Rejected`. The source uses eight `Closed`, one `Rejected`, and one `In Review` annotation. Matching `Rejected` as a string does not establish that it is the expected prediction or a documented human decision. No automatic `Closed → Approved` or `In Review → Pending Review` mapping is applied.

The source's five distinct assignee strings—`Structural Engineer`, `Lead Architect`, `Electrical Engineer`, `Civil Engineer`, and `Design Coordinator`—do not exactly match the schema's role enum. Six named conflict strings also fall outside its conflict-type enum. The four `None` strings remain raw annotations; they are not independently verified evidence of no conflict and are not inserted as conflict objects.

Before these rows become integration inputs or evaluation cases, the team needs to supply or decide:

1. Explicit project IDs, submitters, and submission dates, with their provenance recorded.
2. Explicit report links and supporting records where available. If no context was intentionally supplied, confirm that absence before representing it as an empty link list with a completeness warning. This still does not establish approval readiness.
3. Whether `assignee`, `status`, and `conflict` describe supplied current state or proposed expected outcomes. Expected outcomes belong in a separately reviewed answer key; current-state information needs an agreed input contract.
4. Any intended status, role, and conflict vocabulary mapping. The compatibility work records mismatches and preserves raw values without choosing the final mapping.

The existing schemas and [evaluation design](evaluation-design.md) are unchanged. Completing metadata and resolving annotation meaning does not itself test status tracking, reviewer responsibility, or approval enforcement.

## Reproduce the audit

From the repository root:

```sh
npm ci
npm run prepare-demo2-team
npm run validate-demo2-team
```

The preparation command writes five deterministic artifacts under `demo2/data/prepared/team-tc/`:

| Artifact | Purpose |
| --- | --- |
| [`compatibility-report.json`](../data/prepared/team-tc/compatibility-report.json) | Row-level gaps, vocabulary checks, and counts. |
| [`candidate-rfis.json`](../data/prepared/team-tc/candidate-rfis.json) | Partial conservative candidates; not model inputs. |
| [`source-annotations.json`](../data/prepared/team-tc/source-annotations.json) | Raw annotations separated pending semantic review. |
| [`ready-inputs.json`](../data/prepared/team-tc/ready-inputs.json) | Ready canonical inputs only; currently `[]`. |
| [`manifest.json`](../data/prepared/team-tc/manifest.json) | Relative source/schema paths and full SHA-256 hashes. |

The validation command invokes the same CLI with `--check`, rebuilds expected artifacts in memory, and compares saved bytes without writing files. Passing means that the reported compatibility state is reproducible, including its blocked rows. Neither command calls a model, runs the application or API, checks deployment, or measures accuracy or time savings.
