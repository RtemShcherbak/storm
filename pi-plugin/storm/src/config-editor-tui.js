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
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, SelectList, SettingsList, Text } from "@earendil-works/pi-tui";

export { buildEditorItems } from "./config-editor-items.js";
export const MODEL_PICKER_CLEAR = "__storm_clear__";

/**
 * Show the interactive TUI config editor.
 *
 * Every editable row carries a SettingsList `submenu` — a native feature that
 * renders a child component inline and, on `done(value)`, fires onChange. No
 * nested ctx.ui.custom calls (which break Pi's showExtensionCustom), no
 * close/reopen loop. Stage rows cycle on/off via `values`.
 *
 * Resolves to { action: "save" | "cancel", draft }.
 */
export async function showConfigEditor(ctx, { draft, defaults, env = process.env }) {
  if (ctx.mode !== "tui" && typeof ctx.ui?.custom !== "function") {
    return { action: "cancel", draft };
  }

  let edited = draft;
  let errorMessage = null;
  let modelOptions = [];
  let retrieverOptions = [];

  async function refreshModelOptions() {
    try {
      await ctx.modelRegistry?.refresh?.();
    } catch {
      // fail-soft
    }
    const models = await (ctx.modelRegistry?.getAvailable?.() ?? []);
    modelOptions = [
      { value: MODEL_PICKER_CLEAR, label: "Clear selection (unset)" },
      ...models.map((m) => `${m.provider}/${m.id}`).sort((a, b) => a.localeCompare(b))
        .map((r) => ({ value: r, label: r })),
    ];
  }

  async function refreshRetrieverOptions() {
    const defs = listStormRetrievers();
    retrieverOptions = [
      { value: MODEL_PICKER_CLEAR, label: "Clear selection (unset)" },
      ...defs.map((d) => ({ value: d.id, label: d.label })),
    ];
  }

  function applyChange(id, value) {
    if (id.startsWith("model.")) {
      const role = id.slice("model.".length);
      edited = value === MODEL_PICKER_CLEAR ? clearModel(edited, role) : setModel(edited, role, value);
    } else if (id === "retriever.backend") {
      edited = value === MODEL_PICKER_CLEAR ? clearRetriever(edited) : setRetrieverBackend(edited, value);
    } else if (id.startsWith("retriever.setting.")) {
      const key = id.slice("retriever.setting.".length);
      edited = setRetrieverSetting(edited, key, typeof value === "string" ? value.trim() : "");
    } else if (id.startsWith("runtime.text.")) {
      const field = id.slice("runtime.text.".length);
      const res = setRuntimeText(edited, field, value);
      errorMessage = res.error ?? null;
      if (res.draft) edited = res.draft;
    } else if (id.startsWith("runtime.num.")) {
      const field = id.slice("runtime.num.".length);
      const parsed = Number.parseInt(value, 10);
      const res = setRuntimeNumber(edited, field, parsed);
      errorMessage = res.error ?? null;
      if (res.draft) edited = res.draft;
    }
  }

  await Promise.all([refreshModelOptions(), refreshRetrieverOptions()]);

  return ctx.ui.custom((_tui, theme, _kb, done) => {
    // Native SettingsList submenu → Component. SelectList for single-select rows,
    // Input for free-text rows.
    const buildSelectSubmenu = (title, items, currentValue, doneSub) => {
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 1));
      const list = new SelectList(items, Math.min(items.length, 13), {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        noMatch: (t) => theme.fg("warning", t),
      });
      const values = items.map((item) => item.value);
      const idx = values.indexOf(currentValue ?? "");
      if (idx >= 0) list.setSelectedIndex(idx);
      list.onSelect = (item) => doneSub(item.value);
      list.onCancel = () => doneSub(undefined);
      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel"), 1, 0));
      return { render: (w) => container.render(w), invalidate: () => container.invalidate(), handleInput: (data) => list.handleInput(data) };
    };

    const buildInputSubmenu = (label, initialValue, doneSub) => {
      const input = new Input();
      input.setValue(initialValue ?? "");
      input.onSubmit = (value) => doneSub(value);
      input.onEscape = () => doneSub(undefined);
      const container = new Container();
      container.addChild(new Text(theme.fg("accent", theme.bold(label)), 1, 1));
      container.addChild(input);
      container.addChild(new Text(theme.fg("dim", "enter commit · esc cancel"), 1, 0));
      return { render: (w) => container.render(w), invalidate: () => container.invalidate(), handleInput: (data) => input.handleInput(data) };
    };

    const itemsWithSubmenus = buildEditorItems(edited, { env, errorMessage }).map((row) => {
      if (row.id.startsWith("model.")) {
        const role = row.id.slice("model.".length);
        return { ...row, submenu: (currentValue, done) => buildSelectSubmenu(
          `Pick model for ${stormModelRoleLabel(role)}`,
          modelOptions,
          currentValue,
          done,
        ) };
      }
      if (row.id === "retriever.backend") {
        return { ...row, submenu: (currentValue, done) => buildSelectSubmenu(
          "Choose retriever backend",
          retrieverOptions,
          currentValue,
          done,
        ) };
      }
      if (row.id.startsWith("retriever.setting.")) {
        const key = row.id.slice("retriever.setting.".length);
        return { ...row, submenu: (currentValue, done) => buildInputSubmenu(
          `Retriever ${key}`, currentValue, done,
        ) };
      }
      if (row.id.startsWith("runtime.text.")) {
        const field = row.id.slice("runtime.text.".length);
        const label = RUNTIME_TEXT.find(([f]) => f === field)?.[1] ?? field;
        return { ...row, submenu: (currentValue, done) => buildInputSubmenu(label, currentValue, done) };
      }
      if (row.id.startsWith("runtime.num.")) {
        const field = row.id.slice("runtime.num.".length);
        const label = RUNTIME_NUMERIC.find(([f]) => f === field)?.[1] ?? field;
        return { ...row, submenu: (currentValue, done) => buildInputSubmenu(label, currentValue, done) };
      }
      if (row.id.startsWith("stage.")) {
        return { ...row, values: ["on", "off"] };
      }
      return row;
    });

    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold("STORM configuration")), 1, 1));
    const list = new SettingsList(
      itemsWithSubmenus,
      itemsWithSubmenus.length + 2,
      getSettingsListTheme(),
      (id, value) => {
        if (id === "__save__") { done({ action: "save", draft: edited }); return; }
        if (id === "__cancel__") { done({ action: "cancel", draft: edited }); return; }
        if (id === "__reset__") {
          edited = resetDraftToDefaults(edited, defaults);
          errorMessage = null;
          return;
        }
        applyChange(id, value);
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
}
