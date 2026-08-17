import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArtifactView } from "../src/artifact-view.js";
import { inspectStormArtifacts } from "../src/artifacts.js";
import stormExtension from "../src/index.js";
import { saveStormConfig } from "../src/config.js";
import { setStormPreflightProbesForTesting } from "../src/preflight.js";
import { EventEmitter } from "node:events";
import { setStormProcessSpawnerForTesting } from "../src/process.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

const fullStageFlags = {
  doResearch: true,
  doGenerateOutline: true,
  doGenerateArticle: true,
  doPolishArticle: true,
};

// 1. Polished article is primary when polish completed.
{
  const dir = mkdtempSync(join(tmpdir(), "av-polish-"));
  try {
    writeFileSync(join(dir, "conversation_log.json"), "{}");
    writeFileSync(join(dir, "raw_search_results.json"), "{}");
    writeFileSync(join(dir, "storm_gen_outline.txt"), "o");
    writeFileSync(join(dir, "storm_gen_article.txt"), "a");
    writeFileSync(join(dir, "url_to_info.json"), "{}");
    writeFileSync(join(dir, "storm_gen_article_polished.txt"), "p");
    const snapshot = await inspectStormArtifacts(dir, { selectedStages: fullStageFlags });
    const view = buildArtifactView(snapshot);
    check("polished article is primary", view.primaryResult.stage === "polish");
    check("canonical artifact list shown", view.canonicalArtifacts.length >= 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. Draft article is primary when article complete but polish did not.
{
  const dir = mkdtempSync(join(tmpdir(), "av-article-"));
  try {
    writeFileSync(join(dir, "conversation_log.json"), "{}");
    writeFileSync(join(dir, "raw_search_results.json"), "{}");
    writeFileSync(join(dir, "storm_gen_outline.txt"), "o");
    writeFileSync(join(dir, "storm_gen_article.txt"), "a");
    writeFileSync(join(dir, "url_to_info.json"), "{}");
    const snapshot = await inspectStormArtifacts(dir, { selectedStages: fullStageFlags });
    const view = buildArtifactView(snapshot);
    check("draft article is primary when polish missing", view.primaryResult.stage === "article");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. Outline is primary when outline complete but article did not.
{
  const dir = mkdtempSync(join(tmpdir(), "av-outline-"));
  try {
    writeFileSync(join(dir, "conversation_log.json"), "{}");
    writeFileSync(join(dir, "raw_search_results.json"), "{}");
    writeFileSync(join(dir, "direct_gen_outline.txt"), "o");
    writeFileSync(join(dir, "storm_gen_outline.txt"), "o");
    const snapshot = await inspectStormArtifacts(dir, { selectedStages: fullStageFlags });
    const view = buildArtifactView(snapshot);
    check("outline is primary when article missing", view.primaryResult.stage === "outline");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 4. Research artifacts surfaced when research is last completed stage.
{
  const dir = mkdtempSync(join(tmpdir(), "av-research-"));
  try {
    writeFileSync(join(dir, "conversation_log.json"), "{}");
    writeFileSync(join(dir, "raw_search_results.json"), "{}");
    const snapshot = await inspectStormArtifacts(dir, { selectedStages: fullStageFlags });
    const view = buildArtifactView(snapshot);
    check("research is primary when last completed", view.primaryResult.stage === "research");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 6. /storm-artifacts command surfaces primary result and canonical list.
{
  const agentDir = mkdtempSync(join(tmpdir(), "av-cmd-agent-"));
  const outputRoot = mkdtempSync(join(tmpdir(), "av-cmd-output-"));
  const runDir = join(outputRoot, "cmd-run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "conversation_log.json"), "{}");
  writeFileSync(join(runDir, "raw_search_results.json"), "{}");
  writeFileSync(join(runDir, "storm_gen_article_polished.txt"), "p");
  process.env.PI_AGENT_DIR = agentDir;
  setStormPreflightProbesForTesting({ pythonAvailable: async () => true, stormImportable: async () => true, outputWritable: async () => true });
  setStormProcessSpawnerForTesting(() => new (class extends EventEmitter { constructor(){super();this.stdout=new EventEmitter();this.stderr=new EventEmitter();} })());
  try {
    await saveStormConfig({ runtime: { outputRoot } }, agentDir);
    class Pi {
      commands = new Map();
      handlers = new Map();
      registerCommand(n, c) { this.commands.set(n, c); }
      on(e, h) { const c = this.handlers.get(e) ?? []; c.push(h); this.handlers.set(e, c); }
    }
    class Ui {
      notifications = [];
      notify(m, l) { this.notifications.push({ m, l }); }
      setStatus() {}
    }
    const pi = new Pi();
    await stormExtension(pi);
    const ui = new Ui();
    const view = await pi.commands.get("storm-artifacts").handler(runDir, { ui });
    check("artifacts command returns primary result", view.primaryResult?.stage === "polish");
    check("artifacts command returns canonical list", view.canonicalArtifacts.length >= 1);
    check("artifacts command notifies canonical list", ui.notifications.some((n) => n.m.includes("canonical artifacts")));
  } finally {
    setStormPreflightProbesForTesting(null);
    setStormProcessSpawnerForTesting(null);
    delete process.env.PI_AGENT_DIR;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

// 7. Adopted run reports true primary regardless of current config selection.
{
  const dir = mkdtempSync(join(tmpdir(), "av-adopted-"));
  try {
    // Adopted dir with a polished article, current config would select only research.
    writeFileSync(join(dir, "conversation_log.json"), "{}");
    writeFileSync(join(dir, "raw_search_results.json"), "{}");
    writeFileSync(join(dir, "storm_gen_article_polished.txt"), "p");
    const snapshot = await inspectStormArtifacts(dir);
    const view = buildArtifactView(snapshot);
    check("adopted run primary reflects polished article", view.primaryResult?.stage === "polish");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 5. Missing nonselected artifacts are not errors.
{
  const dir = mkdtempSync(join(tmpdir(), "av-noselect-"));
  try {
    writeFileSync(join(dir, "conversation_log.json"), "{}");
    writeFileSync(join(dir, "raw_search_results.json"), "{}");
    const selected = { doResearch: true, doGenerateOutline: false, doGenerateArticle: false, doPolishArticle: false };
    const snapshot = await inspectStormArtifacts(dir, { selectedStages: selected });
    const view = buildArtifactView(snapshot);
    check("unselected missing stages not errors", view.primaryResult.stage === "research");
    check("view reports no errors for missing nonselected artifacts", !view.errors || view.errors.length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
