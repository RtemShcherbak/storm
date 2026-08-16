import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultStormConfig,
  loadStormConfig,
  normalizeStormConfig,
  saveStormConfig,
} from "../src/config.js";
import { runStormConfigCommand } from "../src/storm-config.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

class FakeUi {
  constructor(responses = [], selections = []) {
    this.responses = responses;
    this.selections = selections;
    this.notifications = [];
    this.prompts = [];
    this.selects = [];
  }

  async input(prompt, initial) {
    this.prompts.push({ kind: "input", prompt, initial });
    return this.responses.shift();
  }

  async select(prompt, options) {
    this.selects.push({ prompt, options });
    return this.selections.shift();
  }

  notify(message, level) {
    this.notifications.push({ message, level });
  }
}

class FakeModelRegistry {
  constructor(models) {
    this.models = models;
    this.refreshCount = 0;
  }

  async refresh() {
    this.refreshCount += 1;
  }

  async getAvailable() {
    return this.models;
  }

  find(provider, id) {
    return this.models.find((model) => model.provider === provider && model.id === id);
  }
}

const availableModels = [
  { provider: "anthropic", id: "claude-sonnet-4-5" },
  { provider: "openai", id: "gpt-5" },
  { provider: "google", id: "gemini-2.5-pro" },
  { provider: "mistral", id: "mistral-large" },
  { provider: "xai", id: "grok-4" },
];

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

  const ui = new FakeUi(
    ["/workspace/custom-output", "python3.12", "7", "4", "6", "8", "12", "9", "off", "on", "off", "on"],
    [
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-5",
      "google/gemini-2.5-pro",
      "mistral/mistral-large",
      "xai/grok-4",
    ],
  );
  const saved = await runStormConfigCommand({ ui, modelRegistry: new FakeModelRegistry(availableModels) }, { agentDir });
  check("storm-config command updates config", saved.runtime.outputRoot === "/workspace/custom-output" && saved.runtime.python === "python3.12");
  check("storm-config command updates stage flags", saved.stageFlags.doResearch === false && saved.stageFlags.doGenerateOutline === true && saved.stageFlags.doGenerateArticle === false && saved.stageFlags.doPolishArticle === true);
  check("storm-config command updates LM refs", saved.lmModels.conv_simulator_lm === "anthropic/claude-sonnet-4-5" && saved.lmModels.article_polish_lm === "xai/grok-4");
  check("storm-config command updates runtime preferences", saved.runtime.maxConvTurn === 7 && saved.runtime.maxPerspective === 4 && saved.runtime.maxSearchQueriesPerTurn === 6 && saved.runtime.searchTopK === 8 && saved.runtime.retrieveTopK === 12);
  check("storm-config command notifies save", ui.notifications.some((n) => n.message.includes("Saved /storm-config")));
  check("storm-config command refreshes registry", ui.selects.length === 5);

  const afterCommand = await loadStormConfig(agentDir);
  check("storm-config command persists to agent dir", afterCommand.runtime.outputRoot === "/workspace/custom-output" && afterCommand.runtime.python === "python3.12" && afterCommand.lmModels.article_gen_lm === "mistral/mistral-large");

  await saveStormConfig({ lmModels: { conv_simulator_lm: "anthropic/missing-model" } }, agentDir);
  const missingUi = new FakeUi(
    ["/workspace/keep-output", "python3", "3", "3", "3", "3", "3", "10", "on", "on", "on", "on"],
    [
      "keep current (anthropic/missing-model)",
      "keep current (unset)",
      "keep current (unset)",
      "keep current (unset)",
      "keep current (unset)",
    ],
  );
  const missingSaved = await runStormConfigCommand(
    { ui: missingUi, modelRegistry: new FakeModelRegistry(availableModels) },
    { agentDir },
  );
  check("missing selected models are reported", missingUi.notifications.some((n) => n.message.includes("unavailable") || n.message.includes("missing")));
  check("missing model refs are preserved when kept", missingSaved.lmModels.conv_simulator_lm === "anthropic/missing-model");
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
