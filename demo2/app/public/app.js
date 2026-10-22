const state = { tab: "All", rfis: [], selected: null, polling: null };

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const SEVERITY = { H: "High", M: "Medium", L: "Low" };

function badge(item) {
  if (item.processing) return `<span class="badge">Processing…</span>`;
  if (item.status === "queued") return `<span class="badge">Queued</span>`;
  if (item.status === "invalid") return `<span class="badge invalid">Validation failed</span>`;
  if (item.status === "error") return `<span class="badge error">Triage error</span>`;
  const css = { "Pending Review": "pending", "Conflict Flagged": "conflict", "Approved": "approved" }[item.approval_status] ?? "";
  return `<span class="badge ${css}">${escape(item.approval_status)}</span>`;
}

function notify(message, isError = false) {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = isError ? "notice error" : "notice";
  notice.hidden = !message;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

/* ---------- list & tabs ---------- */

function inTab(item, tab) {
  return tab === "All" || item.approval_status === tab;
}

function renderList() {
  for (const button of $("tabs").querySelectorAll("button")) {
    const tab = button.dataset.tab;
    button.classList.toggle("active", tab === state.tab);
    button.querySelector(".count").textContent = `(${state.rfis.filter((item) => inTab(item, tab)).length})`;
  }

  const items = state.rfis.filter((item) => inTab(item, state.tab));
  $("empty").hidden = items.length > 0;
  $("rfi-list").innerHTML = items
    .map((item) => `
      <li data-key="${escape(item.key)}" class="${item.key === state.selected ? "selected" : ""}">
        <div class="row"><span class="id">${escape(item.key)}</span>${badge(item)}</div>
        <div class="title">${escape(item.title || "Untitled")}</div>
      </li>`)
    .join("");
}

async function refresh() {
  const { working, rfis } = await api("/api/rfis");
  state.rfis = rfis;
  renderList();

  const pending = working || rfis.some((item) => item.status === "queued");
  if (pending && !state.polling) state.polling = setInterval(() => refresh().catch(() => {}), 1500);
  if (!pending && state.polling) {
    clearInterval(state.polling);
    state.polling = null;
  }
  if (state.selected) {
    const selected = rfis.find((item) => item.key === state.selected);
    if (selected && !selected.processing && selected.status !== "queued") await showDetail(state.selected, false);
  }
}

/* ---------- detail ---------- */

function renderInfo(record) {
  const rfi = record.rfi ?? {};
  const rows = [
    ["RFI ID", rfi.rfi_id],
    ["Title", rfi.title],
    ["Project", rfi.project_id],
    ["Date Submitted", rfi.date_submitted],
    ["Submitted By", rfi.submitted_by],
    ["Spec / Drawing", rfi.spec_section ?? "—"]
  ];
  $("rfi-info").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escape(v ?? "—")}</dd>`).join("");
  $("rfi-question").textContent = rfi.description ?? "—";

  const reports = record.daily_reports ?? [];
  $("reports").innerHTML = reports.length
    ? reports.map((r) => `
        <div class="card">
          <strong>${escape(r.report_id)}</strong> · ${escape(r.location)}
          <div class="meta">${escape(r.report_date)} · ${escape(r.reported_by)}${r.labor_count == null ? "" : ` · Labor count: ${escape(r.labor_count)}`}</div>
          <div>${escape(r.work_description)}</div>
        </div>`).join("")
    : `<p class="muted">No linked daily field reports.</p>`;

  const validation = record.validation;
  if (!validation) {
    $("validation").innerHTML = `<p class="muted">Waiting to be validated…</p>`;
    return;
  }
  const issues = (list) => list.map((e) => `<li><code>${escape(e.code)}</code> ${escape(e.field)} ${escape(e.message)}</li>`).join("");
  $("validation").innerHTML = `
    <p>${validation.valid ? `<span class="badge approved">Schema valid</span>` : `<span class="badge invalid">Validation failed</span>`}</p>
    ${validation.errors.length ? `<ul class="issues">${issues(validation.errors)}</ul>` : ""}
    ${validation.warnings.length ? `<p class="muted">Warnings</p><ul class="issues">${issues(validation.warnings)}</ul>` : ""}`;
}

function renderEvaluation(evaluation) {
  if (!evaluation) return "";
  if (evaluation.status === "no_answer_key") {
    return `<div class="eval"><h3>Evaluation</h3><p class="muted">No answer-key entry for this RFI.</p></div>`;
  }
  const list = (values) => (values.length ? values.map(escape).join(", ") : "—");
  return `
    <div class="eval">
      <h3>Evaluation vs answer key ${evaluation.passed ? `<span class="badge approved">Pass</span>` : `<span class="badge conflict">Fail</span>`}</h3>
      <table>
        <tr><td>Classification</td><td>${list(evaluation.classification)}</td></tr>
        <tr><td>Expected</td><td>${list(evaluation.expected_conflict_types)}</td></tr>
        <tr><td>Caught</td><td>${list(evaluation.caught)}</td></tr>
        <tr><td>Missed</td><td>${list(evaluation.missed)}</td></tr>
        <tr><td>False flags</td><td>${list(evaluation.false_flags)}</td></tr>
        <tr><td>Gatekeeper</td><td>${evaluation.gate_violation ? "Approved an RFI that needs review" : "OK"}</td></tr>
      </table>
    </div>`;
}

function renderGatekeeper(record) {
  if (record.status === "queued") {
    $("gatekeeper").innerHTML = `<p class="muted">Queued — RFIs are triaged one at a time.</p>`;
    return;
  }
  if (record.status === "invalid") {
    $("gatekeeper").innerHTML = `<p><span class="badge invalid">Validation failed</span></p>
      <p>This RFI was not sent for triage. Fix the validation errors and upload it again.</p>`;
    return;
  }
  if (record.status === "error") {
    $("gatekeeper").innerHTML = `<p><span class="badge error">Triage error</span></p><pre>${escape(record.error)}</pre>`;
    return;
  }

  const ai = record.triage_result;
  const decision = record.human_decision;
  const assignee = decision?.current_assignee ?? ai.current_assignee;
  const conflicts = ai.flagged_conflicts;

  $("gatekeeper").innerHTML = `
    <div class="status-row">
      <div><span class="label">Current assignee</span><strong>${escape(assignee)}</strong></div>
      <div><span class="label">Approval status</span>${badge(record)}</div>
    </div>

    <div class="warning-box ${conflicts.length ? "" : "clear"}">
      <h3>${conflicts.length ? `Conflict warnings (${conflicts.length})` : "No conflicts detected"}</h3>
      ${conflicts.map((c) => `
        <div class="conflict">
          <span class="severity">${escape(SEVERITY[c.severity] ?? c.severity)}</span>
          <strong>${escape(c.conflict_type)}</strong>
          <div>${escape(c.details)}</div>
        </div>`).join("")}
    </div>

    <div class="recommend">
      <h3>AI recommendation</h3>
      <p>${escape(ai.recommended_action)}</p>
      <p class="muted">AI suggested: ${escape(ai.approval_status)} → ${escape(ai.current_assignee)}</p>
    </div>

    ${renderEvaluation(record.evaluation)}

    <div class="actions">
      <button class="approve" data-action="approve">Approve &amp; Route</button>
      <button class="flag" data-action="flag">Flag Conflict</button>
      <button class="clarify" data-action="clarify">Request Clarification</button>
    </div>
    ${decision ? `<p class="decision">Human decision: <strong>${escape(decision.approval_status)}</strong> (${escape(decision.action)}) on ${escape(new Date(decision.decided_at).toLocaleString())}</p>` : ""}

    <details>
      <summary>Prompt sent to the model</summary>
      <pre>${escape(record.prompt)}</pre>
    </details>`;
}

async function showDetail(key, scroll = true) {
  state.selected = key;
  const record = await api(`/api/rfis/${encodeURIComponent(key)}`);
  $("detail").hidden = false;
  renderInfo(record);
  renderGatekeeper({ ...record, processing: false });
  renderList();
  if (scroll && window.innerWidth < 900) $("detail").scrollIntoView({ behavior: "smooth" });
}

/* ---------- events ---------- */

$("tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.tab = button.dataset.tab;
  renderList();
});

$("rfi-list").addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (item) showDetail(item.dataset.key).catch((error) => notify(error.message, true));
});

$("gatekeeper").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action } = button.dataset;
  const hasConflicts = document.querySelectorAll("#gatekeeper .conflict").length > 0;
  if (action === "approve" && hasConflicts &&
      !confirm("The AI flagged conflicts on this RFI. Approve and route anyway?")) return;
  try {
    await api(`/api/rfis/${encodeURIComponent(state.selected)}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    await refresh();
    await showDetail(state.selected, false);
  } catch (error) {
    notify(error.message, true);
  }
});

$("upload").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  const messages = [];
  for (const file of files) {
    try {
      const result = await api("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text()
      });
      const rejected = result.daily_reports.rejected.length;
      messages.push(`${file.name}: ${result.queued.length} RFI(s) queued, ${result.daily_reports.accepted.length} daily report(s) added` +
        (rejected ? `, ${rejected} daily report(s) rejected` : ""));
    } catch (error) {
      messages.push(`${file.name}: ${error.message}`);
    }
  }
  notify(messages.join(" · "), messages.some((m) => /rejected|not valid|error/i.test(m)));
  await refresh();
});

refresh().catch((error) => notify(error.message, true));
