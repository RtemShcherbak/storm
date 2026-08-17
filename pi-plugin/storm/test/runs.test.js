import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { saveStormConfig } from "../src/config.js";
import {
  loadStormRunPointer,
  runStormResumeCommand,
  runStormStartCommand,
  saveStormRunPointer,
} from "../src/runs.js";

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
}

const noopSpawner = () => new FakeChildProcess();

class FakeUi {
  constructor(responses = []) {
    this.responses = responses;
    this.notifications = [];
    this.prompts = [];
  }

  async input(prompt, initial) {
    this.prompts.push({ prompt, initial });
    return this.responses.shift();
  }

  notify(message, level) {
    this.notifications.push({ message, level });
  }
}

const agentDir = mkdtempSync(join(tmpdir(), "storm-runs-agent-"));
const outputRoot = mkdtempSync(join(tmpdir(), "storm-runs-output-"));
try {
  await saveStormConfig({ runtime: { outputRoot } }, agentDir);

  const startUi = new FakeUi();
  const first = await runStormStartCommand({ ui: startUi }, "Alpha Topic", {
    agentDir,
    now: new Date("2026-08-16T12:34:56.000Z"),
    idFactory: () => "aaaa",
    spawnProcess: noopSpawner,
  });
  const second = await runStormStartCommand({ ui: startUi }, "Alpha Topic", {
    agentDir,
    now: new Date("2026-08-16T12:34:56.000Z"),
    idFactory: () => "bbbb",
    spawnProcess: noopSpawner,
  });
  const firstRunDir = first.runDir;
  const secondRunDir = second.runDir;

  check("new runs land under configured output root", firstRunDir.startsWith(outputRoot) && secondRunDir.startsWith(outputRoot));
  check("same topic creates unique directories", firstRunDir !== secondRunDir);
  const firstRunName = basename(firstRunDir);
  check("run directory names are human-readable", firstRunName.startsWith("alpha-topic-20260816-") && firstRunName.endsWith("-aaaa"));
  check("current/last pointer updates after new run selection", (await loadStormRunPointer(agentDir)).currentRunDir === secondRunDir);
  check("start command notifies created run directory", startUi.notifications.some((n) => n.message.includes("Created STORM run directory")));

  const stalePath = join(outputRoot, "missing-run");
  await saveStormRunPointer({ currentRunDir: stalePath }, agentDir);
  const resumeUi = new FakeUi();
  const resumedMissing = await runStormResumeCommand({ ui: resumeUi }, "", { agentDir });
  check("missing pointer target is cleared", resumedMissing === null);
  check("missing pointer target is reported", resumeUi.notifications.some((n) => n.message.includes("stale")));
  check("stale pointer is cleared on disk", (await loadStormRunPointer(agentDir)).currentRunDir === null);

  const adoptedDir = mkdtempSync(join(tmpdir(), "storm-adopted-run-"));
  try {
    writeFileSync(join(adoptedDir, "conversation_log.json"), "{}", "utf8");
    writeFileSync(join(adoptedDir, "raw_search_results.json"), "{}", "utf8");
    writeFileSync(join(adoptedDir, "storm_gen_outline.txt"), "outline", "utf8");
    writeFileSync(join(adoptedDir, "run_config.json"), "{}", "utf8");
    writeFileSync(join(adoptedDir, "llm_call_history.jsonl"), "[]", "utf8");

    const adoptedUi = new FakeUi();
    const selected = await runStormResumeCommand({ ui: adoptedUi }, adoptedDir, { agentDir });
    check("explicit selection can target an existing artifact directory", selected === adoptedDir);
    check("explicit selection preserves existing directory path", (await loadStormRunPointer(agentDir)).currentRunDir === adoptedDir);
    check("explicit selection notifies adoption", adoptedUi.notifications.some((n) => n.message.includes("Selected STORM run directory")));
  } finally {
    rmSync(adoptedDir, { recursive: true, force: true });
  }
} finally {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
}
