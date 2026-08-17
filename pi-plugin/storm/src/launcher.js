import { buildLmAdapterSeam } from "./lm-adapter.js";

function pyBool(value) {
  return value ? "True" : "False";
}

function pyStr(value) {
  return JSON.stringify(String(value ?? ""));
}

/**
 * Build a Python launcher script that executes STORM Wiki through Public API
 * orchestration. Uses STORMWikiRunner, STORMWikiRunnerArguments,
 * STORMWikiLMConfigs, stage flags, retriever config, and post_run().
 *
 * LM adapter and retriever credential mechanisms are integration seams; they
 * are exposed here but not resolved in T11.
 */
export function buildStormLauncherScript(config, options = {}) {
  const runtime = config.runtime ?? {};
  const stageFlags = config.stageFlags ?? {};
  const request = options.request ?? {};
  const runDir = options.runDir ?? runtime.outputRoot ?? ".";

  const runnerArgs = [
    `output_dir=${pyStr(runDir)}`,
    `max_conv_turn=runtime.get('max_conv_turn', 3)`,
    `max_perspective=runtime.get('max_perspective', 3)`,
    `max_search_queries_per_turn=runtime.get('max_search_queries_per_turn', 3)`,
    `search_top_k=runtime.get('search_top_k', 3)`,
    `retrieve_top_k=runtime.get('retrieve_top_k', 3)`,
    `max_thread_num=runtime.get('max_thread_num', 10)`,
  ].join(",\n            ");

  return [
    "import os",
    "import json",
    "from knowledge_storm import STORMWikiRunnerArguments, STORMWikiLMConfigs, STORMWikiRunner",
    "from knowledge_storm.lm import LitellmModel",
    "",
    "def build_lm_configs(lm_models):",
    "    # Pi-to-STORM LM adapter (T12): map each selected Pi model ref to a",
    "    # LitellmModel for its role. Unset roles are incompatible and block launch.",
    "    lm_configs = STORMWikiLMConfigs()",
    "    roles = ['conv_simulator_lm', 'question_asker_lm', 'outline_gen_lm', 'article_gen_lm', 'article_polish_lm']",
    "    for role in roles:",
    "        ref = (lm_models or {}).get(role)",
    "        if not ref:",
    "            raise RuntimeError('missing role %s (no model selected)' % role)",
    "        setattr(lm_configs, role, LitellmModel(model=ref))",
    "    return lm_configs",
    "",
    "def build_rm(seam, k):",
    "    # INTEGRATION SEAM: retriever credential passing (resolved in T13).",
    "    return seam(k)",
    "",
    "def main():",
    "    config = json.loads(os.environ.get('STORM_LAUNCH_CONFIG', '{}'))",
    "    topic = config.get('topic', '')",
    "    ground_truth_url = config.get('ground_truth_url') or ''",
    "    stage = config.get('stage_flags', {})",
    "    runtime = config.get('runtime', {})",
    "    retriever = config.get('retriever', {})",
    "    lm_models = config.get('lm_models', {})",
    "",
    `    engine_args = STORMWikiRunnerArguments(\n        ${runnerArgs}\n    )`,
    "",
    "    lm_configs = build_lm_configs(lm_models)",
    "    rm = build_rm(_noop_rm_seam, engine_args.search_top_k)",
    "",
    "    runner = STORMWikiRunner(engine_args, lm_configs, rm)",
    "    runner.run(",
    "        topic=topic,",
    "        ground_truth_url=ground_truth_url,",
    `        do_research=${pyBool(stageFlags.doResearch ?? true)},`,
    `        do_generate_outline=${pyBool(stageFlags.doGenerateOutline ?? true)},`,
    `        do_generate_article=${pyBool(stageFlags.doGenerateArticle ?? true)},`,
    `        do_polish_article=${pyBool(stageFlags.doPolishArticle ?? true)},`,
    "    )",
    "    runner.post_run()",
    "",
    "def _noop_rm_seam(k):",
    "    raise RuntimeError('retriever seam not wired (T13)')",
    "",
    "if __name__ == '__main__':",
    "    main()",
    "",
  ].join("\n");
}

/**
 * Build the environment payload passed to the STORM process so the launcher
 * script can reconstruct config/request/retriever without hardcoding.
 */
export function buildStormLaunchEnv(config, options = {}) {
  const request = options.request ?? {};
  const { modelRefs } = buildLmAdapterSeam(config.lmModels);
  return {
    STORM_LAUNCH_CONFIG: JSON.stringify({
      topic: request.topic ?? null,
      ground_truth_url: request.groundTruthUrl ?? null,
      lm_models: modelRefs,
      stage_flags: {
        do_research: config.stageFlags?.doResearch ?? true,
        do_generate_outline: config.stageFlags?.doGenerateOutline ?? true,
        do_generate_article: config.stageFlags?.doGenerateArticle ?? true,
        do_polish_article: config.stageFlags?.doPolishArticle ?? true,
      },
      runtime: {
        max_conv_turn: config.runtime?.maxConvTurn ?? 3,
        max_perspective: config.runtime?.maxPerspective ?? 3,
        max_search_queries_per_turn: config.runtime?.maxSearchQueriesPerTurn ?? 3,
        search_top_k: config.runtime?.searchTopK ?? 3,
        retrieve_top_k: config.runtime?.retrieveTopK ?? 3,
        max_thread_num: config.runtime?.maxThreadNum ?? 10,
      },
      retriever: config.retriever ?? {},
    }),
  };
}
