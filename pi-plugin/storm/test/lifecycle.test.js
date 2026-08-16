import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStormRunLifecycle } from "../src/lifecycle.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

const lifecycle = createStormRunLifecycle();
check("defaults to not_started", lifecycle.snapshot().status === "not_started");

const runDir = mkdtempSync(join(tmpdir(), "storm-lifecycle-run-"));
try {
  const started = lifecycle.start(runDir);
  check("starting run sets running status", started.status === "running" && started.phase === "research");
  check("running status is stage-aware", lifecycle.statusText() === "running:research");
  check("active run is tracked", lifecycle.snapshot().runDir === runDir);

  const postRun = lifecycle.setPhase("post_run");
  check("post_run is representable separately", postRun.status === "running" && postRun.phase === "post_run");
  check("post_run status text is distinct", lifecycle.statusText() === "running:post_run");

  const blocked = lifecycle.start(join(runDir, "second"));
  check("second active start is blocked", blocked.errorCode === "active-run" && blocked.message.includes("already active"));

  const completed = lifecycle.markCompleted();
  check("completed is terminal", completed.status === "completed" && completed.phase === null);
  check("completion does not erase run identity", lifecycle.snapshot().runDir === runDir);
  check("completed status text is available", lifecycle.statusText() === "completed");

  lifecycle.clear();
  check("clear returns to not_started", lifecycle.snapshot().status === "not_started");

  const failed = lifecycle.start(runDir);
  check("can restart after clear", failed.status === "running");
  check("failed is terminal", lifecycle.markFailed().status === "failed");
  check("cancelled is terminal", lifecycle.start(runDir).status === "running" && lifecycle.markCancelled().status === "cancelled");
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
