import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultStormConfig,
  loadStormConfig,
  normalizeStormConfig,
  saveStormConfig,
} from "../src/config.js";


function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

const agentDir = mkdtempSync(join(tmpdir(), "storm-config-test-"));
try {
  const defaults = defaultStormConfig();
  check("defaults include LM role refs", Object.values(defaults.lmModels).every((value) => value === null));
  check("defaults enable research", defaults.stageFlags.doResearch === true);
  check("defaults enable outline", defaults.stageFlags.doGenerateOutline === true);
  check("defaults enable article", defaults.stageFlags.doGenerateArticle === true);
  check("defaults enable polish", defaults.stageFlags.doPolishArticle === true);
  check("defaults use STORM runtime defaults", defaults.runtime.maxConvTurn === 3 && defaults.runtime.maxThreadNum === 10);
  check("disable_perspective is not exposed", !Object.hasOwn(defaults.runtime, "disablePerspective"));

  const normalized = normalizeStormConfig({
    lmModels: { conv_simulator_lm: " anthropic/claude-sonnet-4-5 " },
    stageFlags: { doResearch: false },
    runtime: { outputRoot: "/tmp/storm", python: "python3.11" },
    secrets: { apiKey: "shh" },
  });
  check("normalize trims model refs", normalized.lmModels.conv_simulator_lm === "anthropic/claude-sonnet-4-5");
  check("normalize merges stage flags", normalized.stageFlags.doResearch === false && normalized.stageFlags.doGenerateOutline === true);
  check("normalize merges runtime settings", normalized.runtime.outputRoot === "/tmp/storm" && normalized.runtime.python === "python3.11");
  check("normalize drops unknown secret fields", !Object.hasOwn(normalized, "secrets"));

  await saveStormConfig({
    lmModels: { conv_simulator_lm: "anthropic/claude-sonnet-4-5" },
    stageFlags: { doResearch: false },
    runtime: {
      outputRoot: "/tmp/storm-output",
      python: "python3",
      maxConvTurn: 4,
      maxPerspective: 2,
      maxSearchQueriesPerTurn: 5,
      searchTopK: 7,
      retrieveTopK: 8,
      maxThreadNum: 9,
      apiKey: "should-not-persist",
    },
  }, agentDir);

  const file = readFileSync(join(agentDir, "storm.json"), "utf8");
  check("serialized config does not contain secret-looking fields", !file.includes("apiKey"));
  const loaded = await loadStormConfig(agentDir);
  check("saved config survives reload", loaded.lmModels.conv_simulator_lm === "anthropic/claude-sonnet-4-5" && loaded.runtime.outputRoot === "/tmp/storm-output");
  check("loaded config keeps runtime numbers", loaded.runtime.maxThreadNum === 9 && loaded.runtime.searchTopK === 7);

  // Round-trip preserves known structure and drops secret fields.
  const afterSave = await saveStormConfig({ ...defaultStormConfig(), runtime: { ...defaultStormConfig().runtime, maxConvTurn: 6 } }, agentDir);
  check("saveStormConfig returns normalized config", afterSave.runtime.maxConvTurn === 6);
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
