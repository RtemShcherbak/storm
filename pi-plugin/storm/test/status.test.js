import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStormConfig } from "../src/config.js";
import { createStormRunLifecycle } from "../src/lifecycle.js";
import stormExtension from "../src/index.js";
import { setStormProcessSpawnerForTesting } from "../src/process.js";
import { setStormPreflightProbesForTesting } from "../src/preflight.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
  emitSpawn() {
    this.emit("spawn");
  }
  emitClose(code, signal = null) {
    this.emit("close", code, signal);
  }
}

class Ui {
  statuses = new Map();
  notifications = [];
  setStatus(k, v) {
    this.statuses.set(k, v);
  }
  notify(m, l) {
    this.notifications.push({ m, l });
  }
  async input() {
    return "Status Topic";
  }
}

class Pi {
  commands = new Map();
  handlers = new Map();
  registerCommand(n, c) {
    this.commands.set(n, c);
  }
  on(e, h) {
    const c = this.handlers.get(e) ?? [];
    c.push(h);
    this.handlers.set(e, c);
  }
}

// 1. Lifecycle statusText covers every state in the vocabulary.
{
  const lc = createStormRunLifecycle();
  check("not_started statusText", lc.statusText() === "not_started");
  lc.start("/tmp/r", "research");
  check("running:research statusText", lc.statusText() === "running:research");
  lc.setPhase("outline");
  check("running:outline statusText", lc.statusText() === "running:outline");
  lc.setPhase("post_run");
  check("running:post_run statusText", lc.statusText() === "running:post_run");
  lc.markCompleted();
  check("completed statusText", lc.statusText() === "completed");
  lc.start("/tmp/r2", "research");
  lc.markFailed();
  check("failed statusText", lc.statusText() === "failed");
  lc.start("/tmp/r3", "research");
  lc.markCancelled();
  check("cancelled statusText", lc.statusText() === "cancelled");
}

// 2. /storm-status reports active/current run state through the extension.
{
  const agentDir = mkdtempSync(join(tmpdir(), "storm-status-agent-"));
  const outputRoot = mkdtempSync(join(tmpdir(), "storm-status-output-"));
  const fake = new FakeChild();
  setStormProcessSpawnerForTesting(() => fake);
  setStormPreflightProbesForTesting({ pythonAvailable: async () => true, stormImportable: async () => true, outputWritable: async () => true });
  process.env.PI_AGENT_DIR = agentDir;
  try {
    await saveStormConfig({
      lmModels: { conv_simulator_lm: "anthropic/claude-sonnet-4-5", question_asker_lm: "anthropic/claude-sonnet-4-5", outline_gen_lm: "anthropic/claude-sonnet-4-5", article_gen_lm: "anthropic/claude-sonnet-4-5", article_polish_lm: "anthropic/claude-sonnet-4-5" },
      retriever: { backend: "duckduckgo", settings: {} },
      runtime: { outputRoot },
    }, agentDir);
    const registry = {
      async getAvailable() {
        return [{ provider: "anthropic", id: "claude-sonnet-4-5" }];
      },
      find(p, i) {
        return p === "anthropic" && i === "claude-sonnet-4-5" ? { provider: p, id: i } : undefined;
      },
    };
    const pi = new Pi();
    await stormExtension(pi);

    // Before any run, status is not_started / no active run.
    const idleStatus = await pi.commands.get("storm-status").handler("", { ui: new Ui() });
    check("status before run is not_started", idleStatus.status === "not_started");

    // Start a run → running:research via status.
    const startCtx = { ui: new Ui(), modelRegistry: registry };
    await pi.commands.get("storm-start").handler("Status Topic", startCtx);
    const runningStatus = await pi.commands.get("storm-status").handler("", { ui: new Ui() });
    check("status running includes phase", runningStatus.status === "running" && runningStatus.phase === "research");

    // Missing callback events do not break progress: status comes from lifecycle.
    fake.emitSpawn();
    const duringStatus = await pi.commands.get("storm-status").handler("", { ui: new Ui() });
    check("status works without callbacks", duringStatus.status === "running");

    // Complete the run → status completed.
    mkdirSync(runningStatus.runDir ?? "/tmp/status-run", { recursive: true });
    const completeDir = runningStatus.runDir ?? "/tmp/status-run";
    writeFileSync(join(completeDir, "run_config.json"), "{}", "utf8");
    writeFileSync(join(completeDir, "llm_call_history.jsonl"), "[]", "utf8");
    fake.emitClose(0);
    await new Promise((r) => setTimeout(r, 20));
    const completedStatus = await pi.commands.get("storm-status").handler("", { ui: new Ui() });
    check("status completed after post_run", completedStatus.status === "completed");
  } finally {
    setStormProcessSpawnerForTesting(null);
    setStormPreflightProbesForTesting(null);
    delete process.env.PI_AGENT_DIR;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  }
}
