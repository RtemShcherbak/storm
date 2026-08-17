import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultStormConfig, saveStormConfig } from "../src/config.js";
import {
  buildStormProcessInvocation,
  getStormWorkspaceRoot,
  launchManagedStormProcess,
  setStormProcessSpawnerForTesting,
} from "../src/process.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = false;
    this.closed = false;
  }

  kill() {
    this.killed = true;
  }

  emitStdout(text) {
    this.stdout.emit("data", Buffer.from(text));
  }

  emitStderr(text) {
    this.stderr.emit("data", Buffer.from(text));
  }

  emitSpawn() {
    this.emit("spawn");
  }

  emitClose(code, signal = null) {
    this.closed = true;
    this.emit("close", code, signal);
  }

  emitError(error) {
    this.emit("error", error);
  }
}

const agentDir = mkdtempSync(join(tmpdir(), "storm-process-agent-"));
const outputRoot = mkdtempSync(join(tmpdir(), "storm-process-output-"));
const runDir = join(outputRoot, "alpha-topic-20260816-aaaa");
try {
  await saveStormConfig({ runtime: { outputRoot, python: "python-custom" } }, agentDir);

  const invocation = buildStormProcessInvocation(defaultStormConfig(), { runDir });
  check("invocation uses configured python command", invocation.command === "python3");
  check("invocation targets workspace fork", invocation.options.cwd === getStormWorkspaceRoot());
  check("invocation uses local knowledge_storm source", invocation.args.join(" ").includes("from knowledge_storm import"));

  const fakeChild = new FakeChildProcess();
  const spawnCalls = [];
  setStormProcessSpawnerForTesting((spec) => {
    spawnCalls.push(spec);
    return fakeChild;
  });

  const handle = launchManagedStormProcess({
    config: { runtime: { python: "python-custom" } },
    runDir,
  });
  check("launch returns a diagnostics handle", typeof handle.outcome.then === "function" && handle.child === fakeChild);
  check("launch spawns using configured command", spawnCalls[0].command === "python-custom");
  check("launch spawns inside workspace fork", spawnCalls[0].options.cwd === getStormWorkspaceRoot());

  fakeChild.emitSpawn();
  fakeChild.emitStdout("hello stdout\n");
  fakeChild.emitStderr("hello stderr\n");
  fakeChild.emitClose(0);
  const success = await handle.outcome;
  check("successful process exit is classified", success.kind === "success" && success.exitCode === 0);
  check("stdout is captured as diagnostics", success.diagnostics.stdout.includes("hello stdout"));
  check("stderr is captured as diagnostics", success.diagnostics.stderr.includes("hello stderr"));
  check("successful process does not remain alive", fakeChild.closed === true && fakeChild.killed === false);

  const runtimeChild = new FakeChildProcess();
  setStormProcessSpawnerForTesting(() => runtimeChild);
  const runtimeHandle = launchManagedStormProcess({ config: { runtime: { python: "python-custom" } }, runDir });
  runtimeChild.emitSpawn();
  runtimeChild.emitError(new Error("boom"));
  const runtimeFailure = await runtimeHandle.outcome;
  check("runtime failure is classified separately", runtimeFailure.kind === "runtime-failure" && runtimeFailure.error.message === "boom");
  check("runtime failure cleans up the child process", runtimeChild.killed === true);

  const startFailureHandle = launchManagedStormProcess({
    config: { runtime: { python: "python-custom" } },
    runDir,
    spawnProcess: () => {
      throw new Error("spawn failed");
    },
  });
  const startFailure = await startFailureHandle.outcome;
  check("start failure is classified separately", startFailure.kind === "start-failure" && startFailure.error.message === "spawn failed");
} finally {
  setStormProcessSpawnerForTesting(null);
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
}
