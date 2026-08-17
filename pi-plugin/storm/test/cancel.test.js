import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStormConfig } from "../src/config.js";
import { createStormRunLifecycle } from "../src/lifecycle.js";
import { cancelActiveStormRun } from "../src/cancel.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killCalls = 0;
  }
  kill() {
    this.killCalls += 1;
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

const runDir = mkdtempSync(join(tmpdir(), "storm-cancel-run-"));
try {
  const lifecycle = createStormRunLifecycle();
  lifecycle.start(runDir, "research");

  const child = new FakeChildProcess();
  const cancelResult = cancelActiveStormRun({ lifecycle, child });
  check("cancel marks lifecycle cancelled", cancelResult.status === "cancelled");
  check("cancel stops the child process", child.killCalls === 1);
  check("cancel does not erase run identity", cancelResult.runDir === runDir);
  check("cancelled status is distinct from failed", cancelResult.status === "cancelled" && cancelResult.status !== "failed");

  // Cancelling when no active run is a no-op result.
  const idleLifecycle = createStormRunLifecycle();
  const idleResult = cancelActiveStormRun({ lifecycle: idleLifecycle, child: null });
  check("cancel with no active run returns null", idleResult === null);

  // A terminated (completed) run is not cancellable.
  const doneLifecycle = createStormRunLifecycle();
  doneLifecycle.start(runDir, "research");
  doneLifecycle.markCompleted();
  const doneResult = cancelActiveStormRun({ lifecycle: doneLifecycle, child });
  check("cancel on completed run returns null", doneResult === null);
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
