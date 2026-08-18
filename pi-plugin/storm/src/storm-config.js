import { defaultStormConfig, loadStormConfig, readStormConfigRaw, saveStormConfigRaw, getStormAgentDir } from "./config.js";
import { createEditorDraft, toSavePayload, KNOWN_TOP_LEVEL_KEYS } from "./config-editor.js";
import { showConfigEditor } from "./config-editor-tui.js";
import { normalizeCommandContext } from "./prompt.js";

function extractExtraKeys(raw) {
  if (!raw || typeof raw !== "object") return {};
  const extra = {};
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.includes(key)) {
      extra[key] = raw[key];
    }
  }
  return extra;
}

function formatReadOnlySummary(config) {
  const lines = [
    "STORM configuration (read-only — editing available only in TUI):",
    "",
    "[Models]",
    ...Object.entries(config.lmModels).map(([role, ref]) => `  ${role}: ${ref ?? "(unset)"}`),
    "",
    `[Retriever] backend: ${config.retriever?.backend ?? "(unset)"}`,
    ...Object.entries(config.retriever?.settings ?? {}).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "[Stages]",
    `  doResearch: ${config.stageFlags?.doResearch ? "on" : "off"}`,
    `  doGenerateOutline: ${config.stageFlags?.doGenerateOutline ? "on" : "off"}`,
    `  doGenerateArticle: ${config.stageFlags?.doGenerateArticle ? "on" : "off"}`,
    `  doPolishArticle: ${config.stageFlags?.doPolishArticle ? "on" : "off"}`,
    "",
    "[Runtime]",
    `  outputRoot: ${config.runtime?.outputRoot}`,
    `  python: ${config.runtime?.python}`,
    `  maxConvTurn: ${config.runtime?.maxConvTurn}`,
    `  maxPerspective: ${config.runtime?.maxPerspective}`,
    `  maxSearchQueriesPerTurn: ${config.runtime?.maxSearchQueriesPerTurn}`,
    `  searchTopK: ${config.runtime?.searchTopK}`,
    `  retrieveTopK: ${config.runtime?.retrieveTopK}`,
    `  maxThreadNum: ${config.runtime?.maxThreadNum}`,
  ];
  return lines.join("\n");
}

export async function runStormConfigCommand(ctx, options = {}) {
  const commandContext = normalizeCommandContext(ctx);
  const agentDir = options.agentDir ?? getStormAgentDir();
  const defaults = defaultStormConfig();
  const current = await loadStormConfig(agentDir);
  const raw = await readStormConfigRaw(agentDir);
  const extra = extractExtraKeys(raw);
  const draft = createEditorDraft(current, extra);

  if (commandContext.mode !== "tui") {
    commandContext.ui.notify(
      "Editing STORM configuration is available only in TUI. Showing current configuration (read-only).",
      "warning",
    );
    commandContext.ui.notify(formatReadOnlySummary(current), "info");
    return { readOnly: true, config: current };
  }

  const editor = options.editor ?? showConfigEditor;
  const result = await editor(commandContext, { draft, defaults, env: process.env });

  if (result.action === "save") {
    const payload = toSavePayload(result.draft);
    // Persist the full payload (known fields + any preserved unknown keys) without
    // dropping unknown keys, so a round-trip never silently deletes data the
    // editor does not understand.
    const saved = await saveStormConfigRaw(payload, agentDir);
    commandContext.ui.notify("Saved /storm-config", "info");
    return saved;
  }

  return null;
}

export default runStormConfigCommand;
