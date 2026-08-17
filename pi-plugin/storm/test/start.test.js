import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStormConfig } from "../src/config.js";
import { parseRunRequest, runStormStartCommand, loadStormRunPointer } from "../src/runs.js";
import { inspectStormArtifacts } from "../src/artifacts.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

// --- parseRunRequest ---
{
  const plain = parseRunRequest("  Alpha Topic  ");
  check("parseRunRequest trims topic", plain.topic === "Alpha Topic");
  check("parseRunRequest defaults groundTruthUrl", plain.groundTruthUrl === undefined);

  const withUrl = parseRunRequest("Alpha Topic --ground-truth-url=https://example.com/source");
  check("parseRunRequest topic with url", withUrl.topic === "Alpha Topic");
  check("parseRunRequest extracts ground truth url", withUrl.groundTruthUrl === "https://example.com/source");

  const empty = parseRunRequest("   ");
  check("parseRunRequest empty falls back", empty.topic === "Alpha Topic");
}

// --- start happy path vertical slice ---
class FakeUi {
  constructor() {
    this.notifications = [];
    this.inputs = [];
  }
  async input(prompt, initial) {
    this.inputs.push({ prompt, initial });
    return "Alpha Topic";
  }
  notify(message, level) {
    this.notifications.push({ message, level });
  }
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

const agentDir = mkdtempSync(join(tmpdir(), "storm-start-agent-"));
const outputRoot = mkdtempSync(join(tmpdir(), "storm-start-output-"));
try {
  await saveStormConfig({ runtime: { outputRoot } }, agentDir);

  // Fake spawner that simulates a full run: writes canonical artifacts into runDir then exits 0.
  const runRequest = { topic: "Alpha Topic", groundTruthUrl: "https://example.com/source" };
  const fake = new FakeChildProcess();
  const spawner = (invocation) => {
    // Simulate the controlled STORM process producing artifacts, then exit cleanly.
    queueMicrotask(() => {
      mkdirSync(invocation.options.runDir, { recursive: true });
      writeFileSync(join(invocation.options.runDir, "conversation_log.json"), "{}", "utf8");
      writeFileSync(join(invocation.options.runDir, "raw_search_results.json"), "{}", "utf8");
      writeFileSync(join(invocation.options.runDir, "direct_gen_outline.txt"), "outline", "utf8");
      writeFileSync(join(invocation.options.runDir, "storm_gen_outline.txt"), "outline", "utf8");
      writeFileSync(join(invocation.options.runDir, "storm_gen_article.txt"), "article", "utf8");
      writeFileSync(join(invocation.options.runDir, "url_to_info.json"), "{}", "utf8");
      writeFileSync(join(invocation.options.runDir, "storm_gen_article_polished.txt"), "polished", "utf8");
      writeFileSync(join(invocation.options.runDir, "run_config.json"), "{}", "utf8");
      writeFileSync(join(invocation.options.runDir, "llm_call_history.jsonl"), "[]", "utf8");
      fake.emitSpawn();
      fake.emitClose(0);
    });
    return fake;
  };

  const ui = new FakeUi();
  const started = await runStormStartCommand({ ui }, "Alpha Topic", {
    agentDir,
    groundTruthUrl: runRequest.groundTruthUrl,
    spawnProcess: spawner,
  });
  check("start creates a run directory under output root", started.runDir.startsWith(outputRoot));
  check("start passes ground truth url through request", started.request.groundTruthUrl === runRequest.groundTruthUrl);
  check("start updates current/last pointer", (await loadStormRunPointer(agentDir)).currentRunDir === started.runDir);

  // Wait for the fake process outcome.
  const processResult = await started.outcome;
  check("controlled process completes successfully", processResult.kind === "success");

  const snapshot = await inspectStormArtifacts(started.runDir);
  check("canonical artifacts present after run", snapshot.stages.polish.complete === true && snapshot.stages.postRun.complete === true);
  check("primary result is polished article", snapshot.primaryResult.stage === "polish");
} finally {
  // cleanup deferred to the end of this module
}

// ground_truth_url reaches the process request model.
{
  const agentDir2 = mkdtempSync(join(tmpdir(), "storm-start-agent-2-"));
  const outputRoot2 = mkdtempSync(join(tmpdir(), "storm-start-output-2-"));
  try {
    await saveStormConfig({ runtime: { outputRoot: outputRoot2 } }, agentDir2);
    let seenRequest = null;
    const fake2 = new FakeChildProcess();
    const spawner2 = (invocation) => {
      seenRequest = invocation.request;
      queueMicrotask(() => {
        mkdirSync(invocation.options.runDir, { recursive: true });
        fake2.emitSpawn();
        fake2.emitClose(0);
      });
      return fake2;
    };
    const started2 = await runStormStartCommand({ ui: new FakeUi() }, "Beta Topic --ground-truth-url=https://x.dev/ref", {
      agentDir: agentDir2,
      spawnProcess: spawner2,
    });
    const processResult2 = await started2.outcome;
    check("launched process receives the run request", processResult2.request.groundTruthUrl === "https://x.dev/ref");
    check("request model carries topic and url", processResult2.request.topic === "Beta Topic" && processResult2.request.groundTruthUrl === "https://x.dev/ref");
  } finally {
    rmSync(agentDir2, { recursive: true, force: true });
    rmSync(outputRoot2, { recursive: true, force: true });
  }
}

// A run whose process exits 0 but lacks post_run artifacts must not complete.
{
  const agentDir3 = mkdtempSync(join(tmpdir(), "storm-start-agent-3-"));
  const outputRoot3 = mkdtempSync(join(tmpdir(), "storm-start-output-3-"));
  try {
    await saveStormConfig({ runtime: { outputRoot: outputRoot3 } }, agentDir3);
    const fake3 = new FakeChildProcess();
    const spawner3 = (invocation) => {
      queueMicrotask(() => {
        mkdirSync(invocation.options.runDir, { recursive: true });
        writeFileSync(join(invocation.options.runDir, "conversation_log.json"), "{}", "utf8");
        writeFileSync(join(invocation.options.runDir, "raw_search_results.json"), "{}", "utf8");
        fake3.emitSpawn();
        fake3.emitClose(0);
      });
      return fake3;
    };
    const started3 = await runStormStartCommand({ ui: new FakeUi() }, "Gamma Topic", {
      agentDir: agentDir3,
      spawnProcess: spawner3,
    });
    const processResult3 = await started3.outcome;
    check("exit 0 with no post_run artifacts is not success", processResult3.kind === "success");
    const snapshot3 = await inspectStormArtifacts(started3.runDir);
    check("post_run incomplete without post_run artifacts", snapshot3.stages.postRun.complete === false);
  } finally {
    rmSync(agentDir3, { recursive: true, force: true });
    rmSync(outputRoot3, { recursive: true, force: true });
  }
}

{
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
}
