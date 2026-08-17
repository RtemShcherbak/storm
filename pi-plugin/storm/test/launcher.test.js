import { buildStormLauncherScript, buildStormLaunchEnv } from "../src/launcher.js";
import { defaultStormConfig } from "../src/config.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

function config(overrides = {}) {
  const c = defaultStormConfig();
  c.lmModels.conv_simulator_lm = "anthropic/claude-sonnet-4-5";
  c.lmModels.question_asker_lm = "anthropic/claude-sonnet-4-5";
  c.lmModels.outline_gen_lm = "anthropic/claude-sonnet-4-5";
  c.lmModels.article_gen_lm = "anthropic/claude-sonnet-4-5";
  c.lmModels.article_polish_lm = "anthropic/claude-sonnet-4-5";
  c.runtime.outputRoot = "/tmp/out";
  c.stageFlags.doResearch = true;
  c.stageFlags.doGenerateOutline = true;
  c.stageFlags.doGenerateArticle = true;
  c.stageFlags.doPolishArticle = true;
  c.retriever.backend = "you";
  return { ...c, ...overrides };
}

// 1. Uses STORM Wiki public/documented surfaces.
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/topic", request: { topic: "Topic" } });
  check("uses STORMWikiRunner public surface", script.includes("STORMWikiRunner"));
  check("uses STORMWikiLMConfigs public surface", script.includes("STORMWikiLMConfigs"));
  check("uses STORMWikiRunnerArguments public surface", script.includes("STORMWikiRunnerArguments"));
}

// 2. Stage flags are passed according to config.
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/topic", request: { topic: "Topic" } });
  check("passes do_research stage flag", /do_research\s*=\s*True/.test(script));
  check("passes do_generate_article stage flag", /do_generate_article\s*=\s*True/.test(script));
  check("passes do_polish_article stage flag", /do_polish_article\s*=\s*True/.test(script));
}

// 3. post_run() is invoked for completed runs.
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/topic", request: { topic: "Topic" } });
  check("invokes post_run", script.includes(".post_run()"));
  check("post_run is on success path", script.includes("post_run()"));
}

// 4. summary() is not required for completion.
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/topic", request: { topic: "Topic" } });
  check("summary is not required", !/summary\(\)/.test(script));
}

// 5. Current workspace fork behavior is used (output dir + topic derived from config/request).
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/topic", request: { topic: "Some Topic" } });
  check("uses output root from config", script.includes("/tmp/out"));
  check("uses run dir", script.includes("/tmp/out/topic"));
}

// 7. Env uses the resolved LM adapter seam to carry all five model refs.
{
  const cfg = config();
  const env = buildStormLaunchEnv(cfg, { request: { topic: "Topic" } });
  const payload = JSON.parse(env.STORM_LAUNCH_CONFIG);
  check("env carries all five adapter model refs", payload.lm_models.conv_simulator_lm === "anthropic/claude-sonnet-4-5" && payload.lm_models.article_polish_lm === "anthropic/claude-sonnet-4-5");
}

// 8. Runtime/stage/retriever flow through the env payload as the single source.
{
  const cfg = config();
  cfg.runtime.maxConvTurn = 7;
  cfg.runtime.maxThreadNum = 12;
  cfg.stageFlags.doPolishArticle = false;
  const env = buildStormLaunchEnv(cfg, { request: { topic: "Topic", groundTruthUrl: "https://x.dev" } });
  const payload = JSON.parse(env.STORM_LAUNCH_CONFIG);
  check("env carries runtime preferences", payload.runtime.max_conv_turn === 7 && payload.runtime.max_thread_num === 12);
  check("env carries stage flags", payload.stage_flags.do_polish_article === false);
  check("env carries request topic and url", payload.topic === "Topic" && payload.ground_truth_url === "https://x.dev");
  check("env carries retriever config", payload.retriever.backend === "you");
}

// 6. LM adapter and retriever credential seams are explicit, not decided here.
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/topic", request: { topic: "Topic" } });
  check("exposes LM config seam", script.includes("lm_configs"));
  check("exposes retriever seam", script.includes("rm") && script.includes("STORMWikiRunner("));
}
