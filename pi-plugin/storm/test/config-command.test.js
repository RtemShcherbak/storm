import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveStormConfig, loadStormConfig, readStormConfigRaw } from "../src/config.js";
import { runStormConfigCommand } from "../src/storm-config.js";
import { createScriptedEditor } from "./helpers/scripted-editor.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

class FakeUi {
  constructor() {
    this.notifications = [];
    this.mode = "tui";
  }
  notify(message, level) {
    this.notifications.push({ message, level });
  }
}

function baseConfig() {
  return {
    lmModels: {
      conv_simulator_lm: "anthropic/claude-sonnet-4-5",
      question_asker_lm: null,
      outline_gen_lm: null,
      article_gen_lm: null,
      article_polish_lm: null,
    },
    retriever: { backend: "you", settings: {} },
    stageFlags: { doResearch: true, doGenerateOutline: true, doGenerateArticle: true, doPolishArticle: true },
    runtime: { outputRoot: "/tmp/out", python: "python3", maxConvTurn: 3, maxPerspective: 3, maxSearchQueriesPerTurn: 3, searchTopK: 3, retrieveTopK: 3, maxThreadNum: 10 },
  };
}

const agentDir = mkdtempSync(join(tmpdir(), "storm-config-cmd-"));
try {
  // 1. Save writes the draft to persistent config.
  {
    await saveStormConfig(baseConfig(), agentDir);
    const ui = new FakeUi();
    const editor = createScriptedEditor([
      { action: "set-model", role: "question_asker_lm", ref: "openai/gpt-5" },
      { action: "set-runtime-number", field: "maxConvTurn", value: 7 },
      { action: "save" },
    ]);
    const result = await runStormConfigCommand({ ui, mode: "tui" }, { agentDir, editor });
    const loaded = await loadStormConfig(agentDir);
    check("save writes model change", loaded.lmModels.question_asker_lm === "openai/gpt-5");
    check("save writes runtime change", loaded.runtime.maxConvTurn === 7);
    check("save returns saved config", result.runtime.maxConvTurn === 7);
    check("save notifies", ui.notifications.some((n) => n.message.includes("Saved /storm-config")));
  }

  // 2. Cancel discards and leaves persistent config unchanged.
  {
    const before = await loadStormConfig(agentDir);
    const ui = new FakeUi();
    const editor = createScriptedEditor([
      { action: "set-model", role: "question_asker_lm", ref: "anthropic/claude-opus-4-5" },
      { action: "cancel" },
    ]);
    const result = await runStormConfigCommand({ ui, mode: "tui" }, { agentDir, editor });
    const after = await loadStormConfig(agentDir);
    check("cancel returns null", result === null);
    check("cancel leaves config unchanged", after.lmModels.question_asker_lm === before.lmModels.question_asker_lm);
  }

  // 3. Reset to defaults produces a default draft on save.
  {
    const ui = new FakeUi();
    const editor = createScriptedEditor([
      { action: "reset" },
      { action: "save" },
    ]);
    await runStormConfigCommand({ ui, mode: "tui" }, { agentDir, editor });
    const loaded = await loadStormConfig(agentDir);
    check("reset clears models", Object.values(loaded.lmModels).every((v) => v === null));
    check("reset restores runtime defaults", loaded.runtime.maxConvTurn === 3 && loaded.runtime.maxThreadNum === 10);
  }

  // 4. Unknown/extra top-level keys survive a round-trip.
  {
    const cfg = baseConfig();
    await saveStormConfig(cfg, agentDir);
    // Simulate a raw config with an unknown key by writing it directly.
    const { writeFileSync } = await import("node:fs");
    const { getStormConfigPath } = await import("../src/config.js");
    const path = getStormConfigPath(agentDir);
    writeFileSync(path, JSON.stringify({ ...cfg, customFuture: { a: 1 } }, null, 2) + "\n", "utf8");
    const ui = new FakeUi();
    const editor = createScriptedEditor([
      { action: "set-runtime-number", field: "maxConvTurn", value: 5 },
      { action: "save" },
    ]);
    await runStormConfigCommand({ ui, mode: "tui" }, { agentDir, editor });
    const raw = await readStormConfigRaw(agentDir);
    check("unknown key preserved on save", raw.customFuture && raw.customFuture.a === 1);
    check("known field saved", raw.runtime.maxConvTurn === 5);
  }

  // 5. Non-TUI shows read-only summary and does not change config.
  {
    await saveStormConfig(baseConfig(), agentDir);
    const ui = new FakeUi();
    ui.mode = "print";
    const result = await runStormConfigCommand({ ui, mode: "print" }, { agentDir });
    check("non-TUI returns read-only marker", result.readOnly === true);
    check("non-TUI notifies editing is TUI-only", ui.notifications.some((n) => n.message.includes("TUI")));
    const loaded = await loadStormConfig(agentDir);
    check("non-TUI does not change config", loaded.runtime.maxConvTurn === baseConfig().runtime.maxConvTurn);
  }
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
