import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDailyReports, displayStatus, getRecord, listRecords, loadDailyReportPool,
  processRfi, queueRfi, recordDecision, recordKey
} from "../src/pipeline.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 5 * 1024 * 1024;
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

/* ---------- one-at-a-time worker ---------- */

let working = false;
let current = null;

async function drainQueue() {
  if (working) return;
  working = true;
  try {
    let next;
    while ((next = listRecords().find((record) => record.status === "queued"))) {
      current = next.key;
      await processRfi(next.rfi, { key: next.key, dailyReportPool: loadDailyReportPool() });
    }
  } finally {
    current = null;
    working = false;
  }
}

/* ---------- upload parsing ---------- */

const isReport = (item) => item && typeof item === "object" && "report_id" in item && !("rfi_id" in item);

function splitUpload(body) {
  if (Array.isArray(body)) {
    return { rfis: body.filter((item) => !isReport(item)), dailyReports: body.filter(isReport) };
  }
  if (body && typeof body === "object" && ("rfis" in body || "daily_reports" in body)) {
    return { rfis: [].concat(body.rfis ?? []), dailyReports: [].concat(body.daily_reports ?? []) };
  }
  if (isReport(body)) return { rfis: [], dailyReports: [body] };
  return { rfis: [body], dailyReports: [] };
}

function handleUpload(body) {
  const { rfis, dailyReports } = splitUpload(body);
  const reports = addDailyReports(dailyReports);
  const stamp = Date.now();
  const queued = rfis.map((rfi, index) => queueRfi(rfi, recordKey(rfi, `upload-${stamp}-${index + 1}`)).key);
  drainQueue();
  return { queued, daily_reports: reports };
}

/* ---------- http ---------- */

function summary(record) {
  return {
    key: record.key,
    status: record.status,
    approval_status: displayStatus(record),
    title: record.rfi?.title ?? null,
    submitted_by: record.rfi?.submitted_by ?? null,
    date_submitted: record.rfi?.date_submitted ?? null,
    conflicts: record.triage_result?.flagged_conflicts.length ?? 0,
    processing: record.key === current
  };
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Upload is larger than 5 MB"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^﻿/, "")));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const file = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, { error: "Not found" });
  }
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

async function route(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");
  const match = pathname.match(/^\/api\/rfis\/([^/]+)(\/action)?$/);

  if (req.method === "GET" && pathname === "/api/rfis") {
    return send(res, 200, { working, rfis: listRecords().map(summary) });
  }
  if (req.method === "POST" && pathname === "/api/upload") {
    return send(res, 202, handleUpload(await readBody(req)));
  }
  if (req.method === "GET" && match && !match[2]) {
    const record = getRecord(decodeURIComponent(match[1]));
    return record
      ? send(res, 200, { ...record, approval_status: displayStatus(record) })
      : send(res, 404, { error: "RFI not found" });
  }
  if (req.method === "POST" && match && match[2]) {
    const { action, note } = await readBody(req);
    const record = recordDecision(decodeURIComponent(match[1]), action, note);
    return send(res, 200, { ...record, approval_status: displayStatus(record) });
  }
  if (req.method === "GET" && !pathname.startsWith("/api/")) return serveStatic(res, pathname);
  return send(res, 404, { error: "Not found" });
}

http
  .createServer((req, res) => {
    route(req, res).catch((error) => send(res, 400, { error: error.message }));
  })
  .listen(PORT, () => {
    console.log(`RFI Triage & Status Tracker running at http://localhost:${PORT}`);
    drainQueue();
  });