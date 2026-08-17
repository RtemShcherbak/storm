import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import {
  STORM_CANONICAL_ARTIFACTS,
  inspectStormArtifacts,
} from "../src/artifacts.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

function touch(path, content = "x") {
  writeFileSync(path, content, "utf8");
}

const runDir = mkdtempSync(join(tmpdir(), "storm-artifacts-test-"));
try {
  touch(join(runDir, "conversation_log.json"));
  touch(join(runDir, "raw_search_results.json"));
  touch(join(runDir, "direct_gen_outline.txt"));
  touch(join(runDir, "storm_gen_outline.txt"));
  touch(join(runDir, "storm_gen_article.txt"));
  touch(join(runDir, "url_to_info.json"));
  touch(join(runDir, "storm_gen_article_polished.txt"));
  touch(join(runDir, "run_config.json"));
  touch(join(runDir, "llm_call_history.jsonl"));

  const snapshot = await inspectStormArtifacts(runDir);

  check("recognizes canonical research artifacts", snapshot.stages.research.complete === true);
  check("recognizes canonical outline artifact", snapshot.stages.outline.complete === true);
  check("recognizes canonical article artifacts", snapshot.stages.article.complete === true);
  check("recognizes canonical polish artifact", snapshot.stages.polish.complete === true);
  check("recognizes canonical post-run artifacts", snapshot.stages.postRun.complete === true);

  const artifactNames = snapshot.canonicalArtifacts.map((artifact) => artifact.name);
  check(
    "canonical artifact list includes all recognized names",
    STORM_CANONICAL_ARTIFACTS.every((name) => artifactNames.includes(name)),
  );
  check("primary result prefers polished article", basename(snapshot.primaryResult.path) === "storm_gen_article_polished.txt");
  check("artifact directory interpretation does not require metadata", snapshot.metadata.present === false);

  const noPolishDir = mkdtempSync(join(tmpdir(), "storm-artifacts-test-no-polish-"));
  try {
    touch(join(noPolishDir, "conversation_log.json"));
    touch(join(noPolishDir, "raw_search_results.json"));
    touch(join(noPolishDir, "direct_gen_outline.txt"));
    touch(join(noPolishDir, "storm_gen_outline.txt"));
    touch(join(noPolishDir, "storm_gen_article.txt"));
    touch(join(noPolishDir, "url_to_info.json"));
    touch(join(noPolishDir, "run_config.json"));
    touch(join(noPolishDir, "llm_call_history.jsonl"));

    const noPolish = await inspectStormArtifacts(noPolishDir);
    check("missing polish stays incomplete", noPolish.stages.polish.complete === false);
    check("missing polish falls back to article primary result", basename(noPolish.primaryResult.path) === "storm_gen_article.txt");
    check("article primary result is still available without polish", noPolish.primaryResult.stage === "article");

    const noPolishSelected = await inspectStormArtifacts(noPolishDir, {
      selectedStages: { research: true, outline: true, article: true, polish: false },
    });
    check("unselected later stage is ignored for primary result", noPolishSelected.primaryResult.stage === "article");
  } finally {
    rmSync(noPolishDir, { recursive: true, force: true });
  }

  const laterArtifactUnselectedDir = mkdtempSync(join(tmpdir(), "storm-artifacts-test-unselected-later-stage-"));
  try {
    touch(join(laterArtifactUnselectedDir, "conversation_log.json"));
    touch(join(laterArtifactUnselectedDir, "raw_search_results.json"));
    touch(join(laterArtifactUnselectedDir, "direct_gen_outline.txt"));
    touch(join(laterArtifactUnselectedDir, "storm_gen_outline.txt"));
    touch(join(laterArtifactUnselectedDir, "storm_gen_article.txt"));
    touch(join(laterArtifactUnselectedDir, "url_to_info.json"));
    touch(join(laterArtifactUnselectedDir, "storm_gen_article_polished.txt"));

    const laterArtifactUnselected = await inspectStormArtifacts(laterArtifactUnselectedDir, {
      selectedStages: { research: true, outline: true, article: true, polish: false },
    });
    check("canonical stage completion still sees later artifact", laterArtifactUnselected.stages.polish.complete === true);
    check("primary result uses last completed selected stage", laterArtifactUnselected.primaryResult.stage === "article");
    check("primary result does not switch to unselected polished artifact", basename(laterArtifactUnselected.primaryResult.path) === "storm_gen_article.txt");
  } finally {
    rmSync(laterArtifactUnselectedDir, { recursive: true, force: true });
  }

  const researchOnlyDir = mkdtempSync(join(tmpdir(), "storm-artifacts-test-research-only-"));
  try {
    touch(join(researchOnlyDir, "conversation_log.json"));
    touch(join(researchOnlyDir, "raw_search_results.json"));

    const researchOnly = await inspectStormArtifacts(researchOnlyDir);
    check("research-only dir is recognized", researchOnly.stages.research.complete === true);
    check("research-only primary result uses research artifacts", researchOnly.primaryResult.stage === "research");
    check("research-only primary result includes both research files", researchOnly.primaryResult.paths.length === 2);
  } finally {
    rmSync(researchOnlyDir, { recursive: true, force: true });
  }
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
