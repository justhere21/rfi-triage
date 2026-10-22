# Demo #2 Evaluation Design

## 1. Project Scope & Objective

- **Option 2 Focus:** GC & Subcontractor RFI Status Tracker & AI Approval Gatekeeper.
- **Core Objective:** Build an interactive AI-assisted workflow using Codex that tracks RFIs through the review pipeline—showing where each RFI is located, who holds approval responsibility, and what AI flags (including discrepancies between RFIs and daily field reports) need resolution before approval and handoff.

## 2. Purpose of the Evaluation

The purpose of this evaluation is to test whether the Demo #2 prototype can correctly:

1. Track the current status of an RFI.
2. Identify who is responsible for the next review or approval step.
3. Detect relevant conflicts or discrepancies between an RFI and supporting project records such as daily field reports.
4. Prevent or flag approval when unresolved issues remain.
5. Allow an RFI to continue through the workflow when required information and approvals are complete.
6. Keep final approval decisions under human control.

## 3. Test Scenarios

The evaluation will include test cases representing both normal and problematic workflow conditions.

### Scenario A: Correct Status Tracking
The system should correctly display the current stage of an RFI, such as:

- Submitted
- GC Review
- Design Review
- Awaiting Clarification
- Approved
- Closed

**Expected Result:** The displayed status matches the source data and current workflow stage.

### Scenario B: Correct Approval Responsibility

The system should identify the person or role responsible for the next action.

Examples may include:

- Subcontractor
- General Contractor
- Architect
- Engineer
- Other authorized reviewer

**Expected Result:** The assigned approval responsibility matches the expected workflow.

### Scenario C: RFI / Daily Report Conflict Detection

The system should compare an RFI with relevant daily field-report information and flag meaningful inconsistencies.

Example:

An RFI states that installation has not begun, while the associated daily field report indicates that the installation has already occurred.

**Expected Result:** The system identifies the discrepancy and requires human review before approval.

### Scenario D: Approval Gatekeeper

An RFI containing an unresolved conflict, missing required information, or incomplete approval should not be treated as ready for final handoff.

**Expected Result:** The system flags the RFI as requiring review rather than automatically approving it.

### Scenario E: Ready-for-Approval Case

An RFI with complete information, no detected conflicts, and the necessary review conditions satisfied should be allowed to proceed.

**Expected Result:** The system identifies the RFI as ready for the next approval or handoff step.

## 4. Expected Labels / Outcomes

Possible evaluation outcomes may include:

- `STATUS_CORRECT`
- `STATUS_INCORRECT`
- `RESPONSIBILITY_CORRECT`
- `RESPONSIBILITY_INCORRECT`
- `CONFLICT_DETECTED`
- `CONFLICT_MISSED`
- `FALSE_CONFLICT`
- `REQUIRES_HUMAN_REVIEW`
- `READY_FOR_APPROVAL`
- `APPROVAL_BLOCKED`

The exact labels should match the final output schema implemented by the team.

## 5. Evaluation Metrics

Each test case will be compared against a predefined answer key.

### Correct Detection
The prototype identifies an issue that is present in the answer key.

### Missed Detection
An expected issue is present in the answer key but is not identified by the prototype.

### False Flag
The prototype identifies a conflict or problem that is not present in the answer key.

### Correct Pass
The prototype correctly allows a complete, non-conflicting RFI to proceed without unnecessary issue flags.

### Workflow Accuracy
The prototype correctly identifies the RFI's status, responsible reviewer, and appropriate next action.

## 6. Evaluation Procedure

1. Prepare test RFIs and related project records.
2. Define the expected status, approval responsibility, conflicts, and routing outcome for each case.
3. Keep the answer key separate from the model input.
4. Run the cases through the Demo #2 prototype.
5. Save the prototype output for each test case.
6. Compare the output against the answer key.
7. Record correct detections, misses, false flags, and workflow errors.
8. Review the results manually to identify limitations or unexpected behavior.

## 7. Human Review Requirement

The AI system is intended to assist with RFI review and workflow coordination, not replace authorized project personnel.

AI-generated flags, routing suggestions, and approval-readiness decisions should therefore remain subject to human review. Final design, contractual, routing, and approval decisions remain with the appropriate authorized team member.

## 8. Demo #2 Evaluation Questions

The evaluation for Demo #2 should answer:

- Does the prototype correctly track where an RFI is in the workflow?
- Does it correctly identify who is responsible for the next action?
- Can it detect discrepancies between RFIs and supporting project records?
- Does it prevent problematic RFIs from appearing ready for approval?
- Does it avoid unnecessarily blocking RFIs that are complete and consistent?
- What types of cases does the system handle successfully?
- Where does the system still make mistakes or require human judgment?

## 9. Interpretation of Results

Demo #2 results will be used to evaluate whether the prototype provides useful pre-approval workflow support.

Successful test cases may support the broader project thesis that improved visibility and AI-assisted validation can reduce preventable clarification and routing delays. However, results from synthetic or limited test data will not by themselves demonstrate a real-world reduction in RFI response time or clarification cycles.

The project's proposed performance targets remain hypotheses that would require testing in an actual project workflow.