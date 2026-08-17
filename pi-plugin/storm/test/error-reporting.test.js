import {
  classifyProcessOutcome,
  buildErrorReport,
  formatErrorReport,
} from "../src/error-reporting.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

// 1. Preflight problems classify as config/preflight errors.
{
  const report = buildErrorReport([{ code: "missing-lm", message: "No model selected" }]);
  check("preflight problem classified as config/preflight", report.category === "config-preflight");
  check("preflight message surfaced", report.message.includes("No model selected"));
}

// 2. Process start failures classify as process-start errors.
{
  const outcome = { kind: "start-failure", error: new Error("python not found") };
  const category = classifyProcessOutcome(outcome);
  check("start failure classified as process-start", category === "process-start");
}

// 3. Runtime STORM failures classify as runtime-STORM errors.
{
  const outcome = { kind: "runtime-failure", error: null, exitCode: 1 };
  check("runtime failure classified as runtime-storm", classifyProcessOutcome(outcome) === "runtime-storm");
}

// 4. User cancellation is not reported as a crash.
{
  const report = buildErrorReport([], { category: "cancelled", message: "STORM run cancelled by user" });
  check("cancellation is a distinct category", report.category === "cancelled");
  check("cancellation is not runtime error", report.category !== "runtime-storm");
}

// 5. Post-run/artifact failures distinguishable.
{
  const report = buildErrorReport([], { category: "artifact-post-run", message: "run_config.json missing" });
  check("post-run/artifact failure classified", report.category === "artifact-post-run");
}

// 6. Diagnostics are present for debugging but not result truth.
{
  const outcome = {
    kind: "runtime-failure",
    error: null,
    exitCode: 1,
    diagnostics: { stdout: "some stdout", stderr: "some stderr" },
  };
  const formatted = formatErrorReport({ category: "runtime-storm", message: "failed", diagnostics: outcome.diagnostics });
  check("formatted report includes diagnostics", formatted.includes("some stderr"));
  check("diagnostics are not the sole message", formatted.includes("failed"));
}
