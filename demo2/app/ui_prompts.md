# UI Layout Notes for App

## Page Overview: RFI Status Tracker & Review Screen

### Top Bar
- **App Title:** RFI Triage & Status Tracke
- **Filter Tabs:** Quick buttons to switch views: `All RFIs`, `Pending Review`, `Conflict Flagged`, `Approved`, and `Rejected`.

### Main Screen

#### Left Side: RFI Info & Field Context
- Show the basic RFI info like ID, title, date submitted, sub name, and question details.
- Below that, display linked daily field reports and relevant drawing or spec numbers.

#### Right Side: AI Gatekeeper & Action Panel
- **Status:** Show who currently has that (`current_assignee`) and the current status badge (`approval_status`).
- **Conflict Warnin Box:** Highlight any issues the AI caught (ex: headcount differences or schedule conflicts).
- **AI Recommendation:** A quick summary box saying what the AI suggests doing next.
- **Action Buttons:** 
  - `Approve & Route`
  - `Flag Conflict`
  - `Request Clarification`

### Design & Colors
- Keep it clean, simple, maybe blue or purple code tone
- **Badge Colors:** 
  - Yellow for `Pending Review`
  - Red for `Conflict Flagged`
  - Green for `Approved`
