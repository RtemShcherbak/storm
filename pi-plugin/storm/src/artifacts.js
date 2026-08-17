import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export const STORM_STAGE_ORDER = Object.freeze(["research", "outline", "article", "polish"]);
export const STORM_POST_RUN_STAGE = "postRun";

export const STORM_CANONICAL_ARTIFACTS = Object.freeze([
  "conversation_log.json",
  "raw_search_results.json",
  "direct_gen_outline.txt",
  "storm_gen_outline.txt",
  "storm_gen_article.txt",
  "url_to_info.json",
  "storm_gen_article_polished.txt",
  "run_config.json",
  "llm_call_history.jsonl",
]);

const STAGE_ARTIFACTS = Object.freeze({
  research: Object.freeze(["conversation_log.json", "raw_search_results.json"]),
  outline: Object.freeze(["storm_gen_outline.txt", "direct_gen_outline.txt"]),
  article: Object.freeze(["storm_gen_article.txt", "url_to_info.json"]),
  polish: Object.freeze(["storm_gen_article_polished.txt"]),
  postRun: Object.freeze(["run_config.json", "llm_call_history.jsonl"]),
});

const PRIMARY_STAGE_ARTIFACT = Object.freeze({
  research: "conversation_log.json",
  outline: "storm_gen_outline.txt",
  article: "storm_gen_article.txt",
  polish: "storm_gen_article_polished.txt",
});

function pathFor(runDir, name) {
  return join(runDir, name);
}

async function presentFiles(runDir, names) {
  const found = [];
  for (const name of names) {
    try {
      await access(pathFor(runDir, name));
      found.push({ name, path: pathFor(runDir, name) });
    } catch {
      // Missing canonical files are expected for incomplete runs.
    }
  }
  return found;
}

function stageComplete(canonicalArtifacts, names) {
  return names.every((name) => canonicalArtifacts.some((artifact) => artifact.name === name));
}

function normalizeSelectedStages(selectedStages) {
  if (!selectedStages || typeof selectedStages !== "object") {
    return { research: true, outline: true, article: true, polish: true };
  }
  return {
    research: selectedStages.research !== false,
    outline: selectedStages.outline !== false,
    article: selectedStages.article !== false,
    polish: selectedStages.polish !== false,
  };
}

function pickPrimaryStage(stages, selectedStages) {
  if (selectedStages.polish && stages.polish.complete) return "polish";
  if (selectedStages.article && stages.article.complete) return "article";
  if (selectedStages.outline && stages.outline.complete) return "outline";
  if (selectedStages.research && stages.research.complete) return "research";
  return null;
}

export async function inspectStormArtifacts(runDir, options = {}) {
  let entries = [];
  try {
    entries = await readdir(runDir);
  } catch {
    entries = [];
  }

  const canonicalArtifacts = entries
    .filter((name) => STORM_CANONICAL_ARTIFACTS.includes(name))
    .sort((a, b) => STORM_CANONICAL_ARTIFACTS.indexOf(a) - STORM_CANONICAL_ARTIFACTS.indexOf(b))
    .map((name) => ({ name, path: pathFor(runDir, name) }));

  const selectedStages = normalizeSelectedStages(options.selectedStages);

  const stages = {
    research: {
      artifacts: await presentFiles(runDir, STAGE_ARTIFACTS.research),
      complete: false,
    },
    outline: {
      artifacts: await presentFiles(runDir, STAGE_ARTIFACTS.outline),
      complete: false,
    },
    article: {
      artifacts: await presentFiles(runDir, STAGE_ARTIFACTS.article),
      complete: false,
    },
    polish: {
      artifacts: await presentFiles(runDir, STAGE_ARTIFACTS.polish),
      complete: false,
    },
    postRun: {
      artifacts: await presentFiles(runDir, STAGE_ARTIFACTS.postRun),
      complete: false,
    },
  };

  stages.research.complete = stageComplete(canonicalArtifacts, STAGE_ARTIFACTS.research);
  stages.outline.complete = stageComplete(canonicalArtifacts, STAGE_ARTIFACTS.outline);
  stages.article.complete = stageComplete(canonicalArtifacts, STAGE_ARTIFACTS.article);
  stages.polish.complete = stageComplete(canonicalArtifacts, STAGE_ARTIFACTS.polish);
  stages.postRun.complete = stageComplete(canonicalArtifacts, STAGE_ARTIFACTS.postRun);

  const primaryStage = pickPrimaryStage(stages, selectedStages);
  const primaryResult = primaryStage
    ? {
        stage: primaryStage,
        label:
          primaryStage === "polish"
            ? "polished article"
            : primaryStage === "article"
              ? "draft article"
              : primaryStage === "outline"
                ? "outline"
                : "research artifacts",
        paths: stages[primaryStage].artifacts.map((artifact) => artifact.path),
        path: canonicalArtifacts.find((artifact) => artifact.name === PRIMARY_STAGE_ARTIFACT[primaryStage])?.path ?? null,
      }
    : null;

  return {
    runDir,
    metadata: { present: false, path: null },
    canonicalArtifacts,
    selectedStages,
    stages,
    primaryResult,
  };
}
