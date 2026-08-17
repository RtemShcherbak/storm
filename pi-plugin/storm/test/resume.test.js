import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectStormArtifacts } from "../src/artifacts.js";
import { computeResumeStageFlags } from "../src/resume.js";
import { buildStormLaunchEnv } from "../src/launcher.js";
import { defaultStormConfig } from "../src/config.js";

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

const runDir = mkdtempSync(join(tmpdir(), "storm-resume-test-"));
try {
  // Research + outline complete, article + polish missing.
  writeFileSync(join(runDir, "conversation_log.json"), "{}", "utf8");
  writeFileSync(join(runDir, "raw_search_results.json"), "{}", "utf8");
  writeFileSync(join(runDir, "direct_gen_outline.txt"), "outline", "utf8");
  writeFileSync(join(runDir, "storm_gen_outline.txt"), "outline", "utf8");

  const snapshot = await inspectStormArtifacts(runDir, { selectedStages: fullStageFlags });
  const flags = computeResumeStageFlags(snapshot, fullStageFlags);
  check("completed research not rerun", flags.doResearch === false);
  check("completed outline not rerun", flags.doGenerateOutline === false);
  check("missing article runs", flags.doGenerateArticle === true);
  check("missing polish runs", flags.doPolishArticle === true);

  // All four stages complete → nothing to rerun.
  writeFileSync(join(runDir, "storm_gen_article.txt"), "article", "utf8");
  writeFileSync(join(runDir, "url_to_info.json"), "{}", "utf8");
  writeFileSync(join(runDir, "storm_gen_article_polished.txt"), "polished", "utf8");
  const completeSnapshot = await inspectStormArtifacts(runDir, { selectedStages: fullStageFlags });
  const completeFlags = computeResumeStageFlags(completeSnapshot, fullStageFlags);
  check("all complete → nothing rerun", !completeFlags.doResearch && !completeFlags.doGenerateOutline && !completeFlags.doGenerateArticle && !completeFlags.doPolishArticle);

  // Unselected stage is not run even if missing.
  const partialFlags = { ...fullStageFlags, doPolishArticle: false };
  const partialSnapshot = await inspectStormArtifacts(runDir, { selectedStages: partialFlags });
  const partialFlagsOut = computeResumeStageFlags(partialSnapshot, partialFlags);
  check("unselected stage not run", partialFlagsOut.doPolishArticle === false);

  // Resume stage flags flow into the launcher env so the Python process runs only missing stages.
  const cfg = defaultStormConfig();
  cfg.lmModels.conv_simulator_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.question_asker_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.outline_gen_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.article_gen_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.article_polish_lm = "anthropic/claude-sonnet-4-5";
  cfg.stageFlags = computeResumeStageFlags(snapshot, fullStageFlags);
  const env = buildStormLaunchEnv(cfg, { request: { topic: "Topic" } });
  const payload = JSON.parse(env.STORM_LAUNCH_CONFIG);
  check("resume launcher skips completed research", payload.stage_flags.do_research === false);
  check("resume launcher runs missing article", payload.stage_flags.do_generate_article === true);
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
