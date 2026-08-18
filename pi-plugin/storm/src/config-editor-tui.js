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
import { listStormRetrievers } from "./retrievers.js";
import { buildEditorItems, RUNTIME_NUMERIC, RUNTIME_TEXT } from "./config-editor-items.js";

export { buildEditorItems } from "./config-editor-items.js";
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
  if (ctx.mode !== "tui" && typeof ctx.ui?.custom !== "function") return null;
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
  if (ctx.mode !== "tui" && typeof ctx.ui?.custom !== "function") return null;
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
  if (ctx.mode !== "tui" && typeof ctx.ui?.custom !== "function") return null;
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
  if (ctx.mode !== "tui" && typeof ctx.ui?.custom !== "function") {
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
    return buildEditorItems(edited, { env, errorMessage });
  }

  let resolveResult;
  let finishEditor = () => {};
  const resultPromise = new Promise((resolve) => { resolveResult = resolve; });

  function handleAction(id) {
    if (id === "__save__") {
      resolveResult({ action: "save", draft: edited });
      finishEditor();
      return;
    }
    if (id === "__cancel__") {
      resolveResult({ action: "cancel", draft: edited });
      finishEditor();
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
    finishEditor = done;
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
