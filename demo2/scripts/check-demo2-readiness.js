import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, serialize, validateDemo2 } from "./lib/demo2-data.js";
import { validateTeamCases } from "./lib/demo2-team-data.js";

const DOCUMENTS = [
  "README.md", "DEPLOY.md", "docs/team-web-presence.md", "demo2/README.md", "demo2/data/README.md",
  "demo2/docs/data-justification.md", "demo2/docs/team-tc-compatibility.md",
  "demo2/docs/verification.md", "demo2/docs/public-link-check.md"
];

function appFiles(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || ["node_modules", ".git", "dist"].includes(entry.name)) return [];
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? appFiles(path.join(directory, entry.name), name) : [name];
  }).sort();
}

export function inspectApplication(files, scripts) {
  const sources = files.filter((file) => /\.(?:[cm]?js|jsx|tsx?|html|py)$/i.test(file) && !/\.(?:test|spec)\./i.test(file));
  const launch = ["start", "dev"].filter((name) => typeof scripts[name] === "string" && scripts[name].trim());
  const blockers = [];
  if (!sources.length) blockers.push("demo2_application_source_missing");
  if (!launch.length) blockers.push("application_start_command_missing");
  return {
    files, source_files: sources, launch_scripts: launch,
    build_script: typeof scripts.build === "string" ? scripts.build : null,
    inventory_blockers: blockers,
    runtime_tested: false, endpoints_tested: false, deployment_tested: false,
    deployment_status: blockers.length ? "blocked" : "unverified",
    note: "Source files and script presence do not establish a working application. Actual commands, endpoints, hosting, and human approval behavior require separate verification."
  };
}

export function checkDocumentLinks(root = ROOT, documents = DOCUMENTS) {
  const errors = [];
  for (const document of documents) {
    const file = path.join(root, document);
    if (!fs.existsSync(file)) { errors.push({ code: "missing_document", file: document }); continue; }
    const markdown = fs.readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const match of markdown.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, "");
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
      const relative = target.split(/[?#]/)[0];
      if (!fs.existsSync(path.resolve(path.dirname(file), relative))) {
        errors.push({ code: "missing_document_link", file: document, target });
      }
    }
  }
  return { valid: errors.length === 0, errors, external_access_checked: false };
}

export function buildReadinessReport() {
  const synthetic = validateDemo2();
  const team = validateTeamCases();
  const links = checkDocumentLinks();
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const appPackage = path.join(ROOT, "demo2/app/package.json");
  const scripts = fs.existsSync(appPackage) ? JSON.parse(fs.readFileSync(appPackage, "utf8")).scripts ?? {} : rootPackage.scripts ?? {};
  const application = inspectApplication(appFiles(path.join(ROOT, "demo2/app")), scripts);
  return {
    offline_checks_passed: synthetic.valid && team.valid && links.valid,
    synthetic_batch: { valid: synthetic.valid, counts: synthetic.report.counts, warnings: synthetic.report.warnings, errors: synthetic.errors },
    team_source_audit: { valid: team.valid, ...team.report.summary, errors: team.errors },
    documentation: links,
    application,
    remaining_handoff: [
      "Publish the actual Demo 2 application entrypoint, installation/start commands, runtime version, and build requirement or explicit no-build statement.",
      "Supply actual API methods/paths, request/response contracts, and a local/test base URL before endpoint checks.",
      "Supply the deployment target, deployment procedure, and application URL before deployment verification.",
      "Resolve TC metadata and annotation meaning with the team; the ten blocked rows are not ready inputs.",
      "Freeze the final demonstration version before release/archive coordination."
    ]
  };
}

export function runReadinessCheck(args = process.argv.slice(2), { logger = console } = {}) {
  try {
    if (args.length) throw new Error("Usage: npm run check-demo2-readiness (no arguments)");
    const report = buildReadinessReport();
    logger.log(serialize(report));
    // Success describes the offline audit only, never an application deployment.
    const exitCode = report.offline_checks_passed ? 0 : 1;
    return { exitCode, report };
  } catch (error) {
    logger.error(error.message);
    return { exitCode: 1 };
  }
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runReadinessCheck().exitCode;
}
