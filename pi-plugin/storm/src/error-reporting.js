/**
 * Coarse error categories (per CONTEXT.md / spec):
 * config-preflight, process-start, runtime-storm, cancelled, artifact-post-run.
 */

export function classifyProcessOutcome(outcome) {
  if (!outcome) return "unknown";
  if (outcome.kind === "start-failure") return "process-start";
  if (outcome.kind === "runtime-failure") return "runtime-storm";
  if (outcome.kind === "success") return "success";
  return "unknown";
}

/**
 * Build a coarse error report.
 *
 * @param {Array<{code:string,message:string}>} preflightProblems
 * @param {{category?:string, message?:string, diagnostics?:{stdout?:string,stderr?:string}, error?:Error}} overrides
 */
export function buildErrorReport(preflightProblems, overrides = {}) {
  if (overrides.category) {
    return {
      category: overrides.category,
      message: overrides.message ?? "",
      diagnostics: overrides.diagnostics ?? {},
      error: overrides.error ?? null,
    };
  }
  if (Array.isArray(preflightProblems) && preflightProblems.length > 0) {
    return {
      category: "config-preflight",
      message: preflightProblems.map((p) => p.message).join("; "),
      diagnostics: {},
      error: null,
    };
  }
  return { category: "unknown", message: "", diagnostics: {}, error: null };
}

export function formatErrorReport(report) {
  const lines = [];
  if (report.category) lines.push(`[${report.category}]`);
  if (report.message) lines.push(report.message);
  const diag = report.diagnostics ?? {};
  if (diag.stderr) lines.push(`stderr: ${diag.stderr}`);
  if (diag.stdout) lines.push(`stdout: ${diag.stdout}`);
  return lines.join("\n");
}
