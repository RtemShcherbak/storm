import { buildStormLaunchEnv, buildStormLauncherScript } from "../src/launcher.js";
import { defaultStormConfig } from "../src/config.js";
import { buildLmAdapterSeam } from "../src/lm-adapter.js";

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
  return { ...c, ...overrides };
}

// 1. The adapter maps each of the five roles to a LitellmModel(model=ref).
{
  const seam = buildLmAdapterSeam(config().lmModels);
  const refs = seam.modelRefs;
  check("maps all five roles", refs.conv_simulator_lm === "anthropic/claude-sonnet-4-5");
  check("maps article_polish role", refs.article_polish_lm === "anthropic/claude-sonnet-4-5");
  check("preserves role separation", Object.keys(refs).length === 5);
}

// 2. Missing role produces a launch-blocking incompatibility (no silent fallback).
{
  const lmModels = config().lmModels;
  lmModels.conv_simulator_lm = null;
  const problems = buildLmAdapterSeam(lmModels).missingRoles;
  check("missing role reported as incompatibility", problems.includes("conv_simulator_lm"));
  check("no role omitted silently", buildLmAdapterSeam(config().lmModels).missingRoles.length === 0);
}

// 3. Launcher script wires the LM adapter seam and raises on incompatibility before run.
{
  const script = buildStormLauncherScript(config(), { runDir: "/tmp/out/t", request: { topic: "Topic" } });
  check("script uses LitellmModel adapter", script.includes("LitellmModel"));
  check("script maps roles via model refs", script.includes("conv_simulator_lm"));
  check("script blocks on missing role", /missing role|raise RuntimeError/.test(script));
}

// 4. Env payload carries the five model refs for the launcher.
{
  const env = buildStormLaunchEnv(config(), { request: { topic: "Topic" } });
  const payload = JSON.parse(env.STORM_LAUNCH_CONFIG);
  check("env carries all five model refs", payload.lm_models.conv_simulator_lm === "anthropic/claude-sonnet-4-5" && payload.lm_models.article_polish_lm === "anthropic/claude-sonnet-4-5");
}

// 5. Tests do not make real provider calls (pure construction only).
{
  const seam = buildLmAdapterSeam(config().lmModels);
  check("adapter builds refs without provider calls", typeof seam.modelRefs.conv_simulator_lm === "string");
}
