import {
  setModel,
  clearModel,
  setRetrieverBackend,
  clearRetriever,
  setRetrieverSetting,
  toggleStage,
  setRuntimeNumber,
  setRuntimeText,
  resetDraftToDefaults,
  STAGE_FIELDS,
} from "./config-editor.js";
import { STORM_LM_ROLES, stormModelRoleLabel } from "./models.js";
import { listStormRetrievers, getStormRetrieverDef, missingRetrieverCredentials } from "./retrievers.js";

const RUNTIME_NUMERIC = [
  ["maxConvTurn", "Max conversation turns", "Maximum conversation turns in research (STORM default 3)."],
  ["maxPerspective", "Max perspectives", "Number of perspectives per conversation turn (STORM default 3)."],
  ["maxSearchQueriesPerTurn", "Max search queries per turn", "Search queries issued per turn (STORM default 3)."],
  ["searchTopK", "Search top-k", "Top-k search results per query (STORM default 3)."],
  ["retrieveTopK", "Retrieve top-k", "Top-k collected references per section (STORM default 3)."],
  ["maxThreadNum", "Max thread num", "Maximum worker threads (STORM default 10)."],
];

const RUNTIME_TEXT = [
  ["outputRoot", "Output root", "Directory where run artifact folders are created (STORM default ./results/gpt)."],
  ["python", "Python command", "Python executable used for out-of-process STORM runs (default python3)."],
];

export const MODEL_PICKER_CLEAR = "__storm_clear__";

async function loadSettingsListTheme() {
  try {
    const agent = await import("@earendil-works/pi-coding-agent");
    return agent.getSettingsListTheme?.() ?? null;
  } catch {
    return null;
  }
}

async function loadTui() {
  // Imported lazily so this module can be loaded (and the command invoked) in
  // non-TUI environments without pi-tui being installed.
  try {
    return await import("@earendil-works/pi-tui");
  } catch {
    return null;
  }
}

async function openSelectList(ctx, title, items, currentValue) {
  if (ctx.mode !== "tui") return null;
  const tui = await loadTui();
  if (!tui) return null;
  const { Container, SelectList, Text } = tui;
  const values = items.map((item) => item.value);
  return await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 1));
    const list = new SelectList(items, Math.min(items.length, 13), {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    const idx = values.indexOf(currentValue ?? "");
    if (idx >= 0) list.setSelectedIndex(idx);
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0));
    return { render: (w) => container.render(w), invalidate: () => container.invalidate(), handleInput: (data) => list.handleInput(data) };
  });
}

async function openModelPicker(ctx, role, currentRef) {
  if (ctx.mode !== "tui") return null;
  try {
    await ctx.modelRegistry?.refresh?.();
  } catch {
    // Fail-soft: use the cached available snapshot if refresh fails.
  }
  const models = await (ctx.modelRegistry?.getAvailable?.() ?? []);
  const refs = models.map((m) => `${m.provider}/${m.id}`).sort((a, b) => a.localeCompare(b));
  const items = [
    { value: MODEL_PICKER_CLEAR, label: "Clear selection (unset)" },
    ...refs.map((r) => ({ value: r, label: r })),
  ];
  return openSelectList(ctx, `Pick model for ${stormModelRoleLabel(role)}`, items, currentRef);
}

async function openRetrieverPicker(ctx, currentBackend) {
  if (ctx.mode !== "tui") return null;
  const defs = listStormRetrievers();
  const items = [
    { value: MODEL_PICKER_CLEAR, label: "Clear selection (unset)" },
    ...defs.map((d) => ({ value: d.id, label: d.label })),
  ];
  return openSelectList(ctx, "Choose retriever backend", items, currentBackend);
}

/**
 * Show the interactive TUI config editor.
 * Resolves to { action: "save", draft } or { action: "cancel", draft }.
 */
export async function showConfigEditor(ctx, { draft, defaults, env = process.env }) {
  if (ctx.mode !== "tui") {
    return { action: "cancel", draft };
  }
  const tui = await loadTui();
  if (!tui) {
    return { action: "cancel", draft };
  }
  const settingsListTheme = await loadSettingsListTheme();
  if (!settingsListTheme) {
    return { action: "cancel", draft };
  }
  const { Container, SettingsList, Text } = tui;
  let edited = draft;
  let errorMessage = null;

  function buildItems() {
    const items = [];
    items.push({ id: "__header_models__", label: "Models", currentValue: "", values: [], description: "Pi model for each STORM LM role", readonly: true });
    for (const role of STORM_LM_ROLES) {
      const ref = edited.lmModels[role];
      items.push({
        id: `model.${role}`,
        label: stormModelRoleLabel(role),
        currentValue: ref ?? "(unset)",
        values: [],
        description: ref ? ref : "No model selected",
      });
    }
    items.push({ id: "__header_retriever__", label: "Retriever", currentValue: "", values: [], description: "STORM search backend", readonly: true });
    const backend = edited.retriever.backend;
    const def = backend ? getStormRetrieverDef(backend) : null;
    const credHint = def && def.credentialEnv.length
      ? `Requires ${def.credentialEnv.join(", ")} — ${missingRetrieverCredentials(def, env).length ? "missing" : "set"}`
      : def ? "No API key required" : "None";
    items.push({ id: "retriever.backend", label: "Retriever backend", currentValue: backend ?? "(unset)", values: [], description: credHint });
    if (def) {
      for (const key of Object.keys(def.settings)) {
        items.push({
          id: `retriever.setting.${key}`,
          label: `${def.label} ${key}`,
          currentValue: edited.retriever.settings[key] ?? "",
          values: [],
          description: `Backend setting for ${def.label}`,
        });
      }
    }
    items.push({ id: "__header_stages__", label: "Stages", currentValue: "", values: [], description: "STORM pipeline stages (full STORM by default)", readonly: true });
    for (const field of STAGE_FIELDS) {
      items.push({
        id: `stage.${field}`,
        label: field,
        currentValue: edited.stageFlags[field] ? "on" : "off",
        values: ["on", "off"],
        description: "Toggle this STORM stage",
      });
    }
    items.push({ id: "__header_runtime__", label: "Runtime", currentValue: "", values: [], description: "Execution and runner settings", readonly: true });
    for (const [field, label, desc] of RUNTIME_TEXT) {
      items.push({ id: `runtime.text.${field}`, label, currentValue: edited.runtime[field] ?? "", values: [], description: desc });
    }
    for (const [field, label, desc] of RUNTIME_NUMERIC) {
      items.push({ id: `runtime.num.${field}`, label, currentValue: String(edited.runtime[field] ?? ""), values: [], description: desc });
    }
    if (errorMessage) {
      items.push({ id: "__error__", label: "", currentValue: errorMessage, values: [], description: "Invalid value rejected", readonly: true });
    }
    items.push({ id: "__reset__", label: "Reset to defaults", currentValue: "", values: [], description: "Reset the whole draft to STORM defaults" });
    items.push({ id: "__save__", label: "Save & close", currentValue: "", values: [], description: "Save the whole draft and close" });
    items.push({ id: "__cancel__", label: "Cancel", currentValue: "", values: [], description: "Discard edits and close" });
    return items;
  }

  let resolveResult;
  const resultPromise = new Promise((resolve) => { resolveResult = resolve; });

  function handleAction(id) {
    if (id === "__save__") {
      resolveResult({ action: "save", draft: edited });
      return;
    }
    if (id === "__cancel__") {
      resolveResult({ action: "cancel", draft: edited });
      return;
    }
    if (id === "__reset__") {
      edited = resetDraftToDefaults(edited, defaults);
      errorMessage = null;
      return;
    }
    if (id.startsWith("model.")) {
      void handleModelAction(id);
      return;
    }
    if (id === "retriever.backend") {
      void handleRetrieverAction();
      return;
    }
    if (id.startsWith("retriever.setting.")) {
      void handleRetrieverSettingAction(id);
      return;
    }
    if (id.startsWith("stage.")) {
      const field = id.slice("stage.".length);
      edited = toggleStage(edited, field);
      return;
    }
    if (id.startsWith("runtime.text.")) {
      void handleRuntimeTextAction(id);
      return;
    }
    if (id.startsWith("runtime.num.")) {
      void handleRuntimeNumAction(id);
      return;
    }
  }

  async function handleModelAction(id) {
    const role = id.slice("model.".length);
    const choice = await openModelPicker(ctx, role, edited.lmModels[role]);
    if (choice === MODEL_PICKER_CLEAR) edited = clearModel(edited, role);
    else if (typeof choice === "string") edited = setModel(edited, role, choice);
  }

  async function handleRetrieverAction() {
    const choice = await openRetrieverPicker(ctx, edited.retriever.backend);
    if (choice === MODEL_PICKER_CLEAR) edited = clearRetriever(edited);
    else if (typeof choice === "string") edited = setRetrieverBackend(edited, choice);
  }

  async function handleRetrieverSettingAction(id) {
    const key = id.slice("retriever.setting.".length);
    const value = await ctx.ui.input(`Retriever ${key}`, edited.retriever.settings[key] ?? "");
    edited = setRetrieverSetting(edited, key, typeof value === "string" ? value.trim() : "");
  }

  async function handleRuntimeTextAction(id) {
    const field = id.slice("runtime.text.".length);
    const label = RUNTIME_TEXT.find(([f]) => f === field)?.[1] ?? field;
    const value = await ctx.ui.input(label, edited.runtime[field] ?? "");
    const res = setRuntimeText(edited, field, value);
    if (res.error) errorMessage = res.error;
    else edited = res.draft;
  }

  async function handleRuntimeNumAction(id) {
    const field = id.slice("runtime.num.".length);
    const label = RUNTIME_NUMERIC.find(([f]) => f === field)?.[1] ?? field;
    const value = await ctx.ui.input(label, String(edited.runtime[field] ?? ""));
    const parsed = Number.parseInt(value, 10);
    const res = setRuntimeNumber(edited, field, parsed);
    if (res.error) errorMessage = res.error;
    else edited = res.draft;
  }

  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold("STORM configuration")), 1, 1));
    const list = new SettingsList(
      buildItems(),
      buildItems().length + 2,
      settingsListTheme,
      handleAction,
      () => {
        resolveResult({ action: "cancel", draft: edited });
        done();
      },
    );
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ move · enter change · esc cancel"), 1, 1));
    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => list.handleInput?.(data),
    };
  });

  return resultPromise;
}
