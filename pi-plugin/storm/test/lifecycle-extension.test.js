import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStormConfig } from "../src/config.js";
import stormExtension from "../src/index.js";
import { setStormProcessSpawnerForTesting } from "../src/process.js";
import { setStormPreflightProbesForTesting } from "../src/preflight.js";

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
setStormPreflightProbesForTesting({
  pythonAvailable: async () => true,
  stormImportable: async () => true,
  outputWritable: async () => true,
});
process.env.PI_AGENT_DIR = agentDir;
const fakeModelRegistry = {
  async getAvailable() {
    return [{ provider: "anthropic", id: "claude-sonnet-4-5" }];
  },
  find(provider, id) {
    return provider === "anthropic" && id === "claude-sonnet-4-5" ? { provider, id } : undefined;
  },
};
try {
  await saveStormConfig(
    {
      lmModels: {
        conv_simulator_lm: "anthropic/claude-sonnet-4-5",
        question_asker_lm: "anthropic/claude-sonnet-4-5",
        outline_gen_lm: "anthropic/claude-sonnet-4-5",
        article_gen_lm: "anthropic/claude-sonnet-4-5",
        article_polish_lm: "anthropic/claude-sonnet-4-5",
      },
      retriever: { backend: "duckduckgo", settings: {} },
      runtime: { outputRoot },
    },
    agentDir,
  );

  const pi = new FakePi();
  await stormExtension(pi);

  const sessionCtx = { ui: new FakeUi() };
  await pi.handlers.get("session_start")?.[0]?.({}, sessionCtx);
  check("session start still shows no active run", sessionCtx.ui.statuses.get("storm") === "○ STORM: no active run");

  const startCtx = { ui: new FakeUi() };
  const firstRunDir = await pi.commands.get("storm-start")?.handler("Alpha Topic", { ...startCtx, modelRegistry: fakeModelRegistry });
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
  // The controlled process writes post_run canonical artifacts before exiting.
  mkdirSync(firstRunDir, { recursive: true });
  writeFileSync(join(firstRunDir, "conversation_log.json"), "{}", "utf8");
  writeFileSync(join(firstRunDir, "raw_search_results.json"), "{}", "utf8");
  writeFileSync(join(firstRunDir, "storm_gen_article_polished.txt"), "polished", "utf8");
  writeFileSync(join(firstRunDir, "run_config.json"), "{}", "utf8");
  writeFileSync(join(firstRunDir, "llm_call_history.jsonl"), "[]", "utf8");
  fakeChild.emitClose(0);
  await new Promise((r) => setTimeout(r, 20));
  const completedStatus = await pi.commands.get("storm-status")?.handler("", { ui: new FakeUi() });
  check("successful process exit completes lifecycle", completedStatus.status === "completed");

  // Cancelling a run then letting the process exit must not mark it completed.
  {
    await saveStormConfig(
      {
        lmModels: {
          conv_simulator_lm: "anthropic/claude-sonnet-4-5",
          question_asker_lm: "anthropic/claude-sonnet-4-5",
          outline_gen_lm: "anthropic/claude-sonnet-4-5",
          article_gen_lm: "anthropic/claude-sonnet-4-5",
          article_polish_lm: "anthropic/claude-sonnet-4-5",
        },
        retriever: { backend: "duckduckgo", settings: {} },
        runtime: { outputRoot },
      },
      agentDir,
    );
    const cancelChild = new FakeChildProcess();
    setStormProcessSpawnerForTesting(() => cancelChild);
    const cancelStartCtx = { ui: new FakeUi() };
    const cancelRunDir = await pi.commands.get("storm-start")?.handler("Cancel Topic", { ...cancelStartCtx, modelRegistry: fakeModelRegistry });
    cancelChild.kill = () => true;
    const cancelCtx = { ui: new FakeUi() };
    const cancelled = await pi.commands.get("storm-cancel")?.handler("", cancelCtx);
    check("cancel marks run cancelled", cancelled.status === "cancelled");
    cancelChild.emitSpawn();
    cancelChild.emitClose(0);
    await new Promise((r) => setTimeout(r, 20));
    const afterCancelStatus = await pi.commands.get("storm-status")?.handler("", { ui: new FakeUi() });
    check("cancelled run is not overridden to completed", afterCancelStatus.status === "cancelled");
  }

  // A config missing a retriever backend must block start before process launch.
  await saveStormConfig(
    {
      lmModels: {
        conv_simulator_lm: "anthropic/claude-sonnet-4-5",
        question_asker_lm: "anthropic/claude-sonnet-4-5",
        outline_gen_lm: "anthropic/claude-sonnet-4-5",
        article_gen_lm: "anthropic/claude-sonnet-4-5",
        article_polish_lm: "anthropic/claude-sonnet-4-5",
      },
      retriever: { backend: null, settings: {} },
      runtime: { outputRoot },
    },
    agentDir,
  );
  let spawnCount = 0;
  setStormProcessSpawnerForTesting(() => {
    spawnCount += 1;
    return new FakeChildProcess();
  });
  const blockedCtx2 = { ui: new FakeUi() };
  const preflightBlocked = await pi.commands.get("storm-start")?.handler("Blocked Topic", { ...blockedCtx2, modelRegistry: fakeModelRegistry });
  check("failed preflight blocks start", preflightBlocked === null);
  check("failed preflight does not launch a process", spawnCount === 0);
  check("failed preflight reports missing requirement", blockedCtx2.ui.notifications.some((n) => n.message.includes("config-preflight")));
} finally {
  setStormProcessSpawnerForTesting(null);
  setStormPreflightProbesForTesting(null);
  if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
}
