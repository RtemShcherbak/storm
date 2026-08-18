import { listStormRetrievers } from "./retrievers.js";
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
} from "./config-editor.js";
import { buildEditorItems, RUNTIME_NUMERIC, RUNTIME_TEXT } from "./config-editor-items.js";
import { STORM_LM_ROLES, stormModelRoleLabel } from "./models.js";

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

/**
 * Open a single-select picker as its own top-level `ctx.ui.custom` — never
 * nested inside another custom component (RLM pattern: model picking happens
 * before the settings panel, never from within its onChange).
 * Resolves to the selected value, or `null` on cancel/esc.
 */
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
 *
 * Follows the RLM pattern: the settings panel is one `ctx.ui.custom` whose
 * `done(result)` resolves the returned promise. Fields that need their own
 * picker/editor are handled by closing the panel with `{ action: "edit", id }`
 * and running that picker as a SEPARATE top-level `ctx.ui.custom` — never
 * nested inside the panel's custom component (nested custom breaks Pi's
 * showExtensionCustom, which only attaches the component after the factory
 * resolves).
 *
 * Resolves to { action: "save" | "cancel", draft }.
 */
export async function showConfigEditor(ctx, { draft, defaults, env = process.env }) {
  if (ctx.mode !== "tui" && typeof ctx.ui?.custom !== "function") {
    return { action: "cancel", draft };
  }
  const tui = await loadTui();
  if (!tui) return { action: "cancel", draft };
  const settingsListTheme = await loadSettingsListTheme();
  if (!settingsListTheme) return { action: "cancel", draft };
  const { Container, SettingsList, Text } = tui;

  let edited = draft;
  let errorMessage = null;

  function buildItems() {
    return buildEditorItems(edited, { env, errorMessage });
  }

  function applyEdit(id, value) {
    // Fields that just need a plain value update are applied inline and stay open.
    if (id.startsWith("stage.")) {
      edited = toggleStage(edited, id.slice("stage.".length));
      return "stay";
    }
    return "edit"; // everything else needs a dedicated top-level picker/editor
  }

  // Main loop: keep re-opening the panel until the user saves or cancels.
  while (true) {
    const result = await ctx.ui.custom((_tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold("STORM configuration")), 1, 1));
      const list = new SettingsList(
        buildItems(),
        buildItems().length + 2,
        settingsListTheme,
        (id, value) => {
          if (id === "__save__") { done({ action: "save", draft: edited }); return; }
          if (id === "__cancel__") { done({ action: "cancel", draft: edited }); return; }
          if (id === "__reset__") {
            edited = resetDraftToDefaults(edited, defaults);
            errorMessage = null;
            return;
          }
          // Everything else: close the panel and let the caller run a dedicated
          // top-level picker/editor for the selected field.
          done({ action: "edit", id, value });
        },
        () => done({ action: "cancel", draft: edited }),
      );
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ move · enter change · esc cancel"), 1, 1));
      return {
        render: (w) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput: (data) => list.handleInput?.(data),
      };
    });

    if (result.action !== "edit") {
      return result;
    }

    // Run the selected field's picker/editor as a separate top-level UI call.
    const { id } = result;
    if (id.startsWith("model.")) {
      const role = id.slice("model.".length);
      const choice = await openModelPicker(ctx, role, edited.lmModels[role]);
      if (choice === MODEL_PICKER_CLEAR) edited = clearModel(edited, role);
      else if (typeof choice === "string") edited = setModel(edited, role, choice);
    } else if (id === "retriever.backend") {
      const choice = await openRetrieverPicker(ctx, edited.retriever.backend);
      if (choice === MODEL_PICKER_CLEAR) edited = clearRetriever(edited);
      else if (typeof choice === "string") edited = setRetrieverBackend(edited, choice);
    } else if (id.startsWith("retriever.setting.")) {
      const key = id.slice("retriever.setting.".length);
      const value = await ctx.ui.input(`Retriever ${key}`, edited.retriever.settings[key] ?? "");
      edited = setRetrieverSetting(edited, key, typeof value === "string" ? value.trim() : "");
    } else if (id.startsWith("runtime.text.")) {
      const field = id.slice("runtime.text.".length);
      const label = RUNTIME_TEXT.find(([f]) => f === field)?.[1] ?? field;
      const value = await ctx.ui.input(label, edited.runtime[field] ?? "");
      const res = setRuntimeText(edited, field, value);
      errorMessage = res.error ?? null;
      if (res.draft) edited = res.draft;
    } else if (id.startsWith("runtime.num.")) {
      const field = id.slice("runtime.num.".length);
      const label = RUNTIME_NUMERIC.find(([f]) => f === field)?.[1] ?? field;
      const value = await ctx.ui.input(label, String(edited.runtime[field] ?? ""));
      const parsed = Number.parseInt(value, 10);
      const res = setRuntimeNumber(edited, field, parsed);
      errorMessage = res.error ?? null;
      if (res.draft) edited = res.draft;
    }
    // Loop back and re-open the panel with the updated draft.
  }
}

// Re-export for callers that want the role list.
export { STORM_LM_ROLES, stormModelRoleLabel };
