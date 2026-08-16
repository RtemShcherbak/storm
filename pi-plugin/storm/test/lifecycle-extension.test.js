import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStormConfig } from "../src/config.js";
import stormExtension from "../src/index.js";
import { setStormProcessSpawnerForTesting } from "../src/process.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

class FakeChildProcess extends EventEmitter {
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

class FakeUi {
  statuses = new Map();
  notifications = [];
  inputs = [];

  setStatus(key, value) {
    this.statuses.set(key, value);
  }

  notify(message, level) {
    this.notifications.push({ message, level });
  }

  async input(prompt, initial) {
    this.inputs.push({ prompt, initial });
    return "Alpha Topic";
  }
}

class FakePi {
  commands = new Map();
  handlers = new Map();

  registerCommand(name, command) {
    this.commands.set(name, command);
  }

  on(eventName, handler) {
    const current = this.handlers.get(eventName) ?? [];
    current.push(handler);
    this.handlers.set(eventName, current);
  }
}

const agentDir = mkdtempSync(join(tmpdir(), "storm-lifecycle-agent-"));
const outputRoot = mkdtempSync(join(tmpdir(), "storm-lifecycle-output-"));
const previousAgentDir = process.env.PI_AGENT_DIR;
const fakeChild = new FakeChildProcess();
setStormProcessSpawnerForTesting(() => fakeChild);
process.env.PI_AGENT_DIR = agentDir;
try {
  await saveStormConfig({ runtime: { outputRoot } }, agentDir);

  const pi = new FakePi();
  await stormExtension(pi);

  const sessionCtx = { ui: new FakeUi() };
  await pi.handlers.get("session_start")?.[0]?.({}, sessionCtx);
  check("session start still shows no active run", sessionCtx.ui.statuses.get("storm") === "○ STORM: no active run");

  const startCtx = { ui: new FakeUi() };
  const firstRunDir = await pi.commands.get("storm-start")?.handler("Alpha Topic", startCtx);
  check("starting a run returns a run directory", typeof firstRunDir === "string" && firstRunDir.startsWith(outputRoot));
  check("starting a run marks running research", startCtx.ui.statuses.get("storm") === "○ STORM: running:research");

  const statusCtx = { ui: new FakeUi() };
  const status = await pi.commands.get("storm-status")?.handler("", statusCtx);
  check("storm-status reports running phase", status.status === "running" && status.phase === "research");
  check("storm-status notifies current lifecycle state", statusCtx.ui.notifications.some((n) => n.message.includes("running:research")));

  const blockedCtx = { ui: new FakeUi() };
  const secondRunDir = await pi.commands.get("storm-start")?.handler("Another Topic", blockedCtx);
  check("second active start is blocked", secondRunDir === null);
  check("second active start notifies conflict", blockedCtx.ui.notifications.some((n) => n.message.includes("one is active")));
  const statusAfterBlock = await pi.commands.get("storm-status")?.handler("", { ui: new FakeUi() });
  check("blocked second start leaves lifecycle running", statusAfterBlock.status === "running" && statusAfterBlock.phase === "research");

  fakeChild.emitSpawn();
  fakeChild.emitClose(0);
  await Promise.resolve();
  const completedStatus = await pi.commands.get("storm-status")?.handler("", { ui: new FakeUi() });
  check("successful process exit completes lifecycle", completedStatus.status === "completed");
} finally {
  setStormProcessSpawnerForTesting(null);
  if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
}
