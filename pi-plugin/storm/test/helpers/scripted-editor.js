import {
  setModel,
  clearModel,
  setRetrieverBackend,
  clearRetriever,
  setRetrieverSetting,
  toggleStage,
  setStage,
  setRuntimeNumber,
  setRuntimeText,
  resetDraftToDefaults,
} from "../../src/config-editor.js";

/**
 * A scripted fake editor implementing the same seam as the real TUI editor:
 *   editor(ctx, { draft, defaults }) -> Promise<{ action, draft }>
 *
 * It models only user-level actions, not SettingsList/rendering internals:
 *   { action: "save" | "cancel" }
 *   { action: "set-model", role, ref }
 *   { action: "clear-model", role }
 *   { action: "set-retriever", backend }
 *   { action: "clear-retriever" }
 *   { action: "set-retriever-setting", key, value }
 *   { action: "toggle-stage", field }
 *   { action: "set-stage", field, value }
 *   { action: "set-runtime-number", field, value }
 *   { action: "set-runtime-text", field, value }
 *   { action: "reset" }
 */
export function createScriptedEditor(script) {
  return async (_ctx, { draft, defaults }) => {
    let current = draft;
    for (const step of script) {
      switch (step.action) {
        case "save":
          return { action: "save", draft: current };
        case "cancel":
          return { action: "cancel", draft: current };
        case "reset":
          current = resetDraftToDefaults(current, defaults);
          break;
        case "set-model":
          current = setModel(current, step.role, step.ref);
          break;
        case "clear-model":
          current = clearModel(current, step.role);
          break;
        case "set-retriever":
          current = setRetrieverBackend(current, step.backend);
          break;
        case "clear-retriever":
          current = clearRetriever(current);
          break;
        case "set-retriever-setting":
          current = setRetrieverSetting(current, step.key, step.value);
          break;
        case "toggle-stage":
          current = toggleStage(current, step.field);
          break;
        case "set-stage":
          current = setStage(current, step.field, step.value);
          break;
        case "set-runtime-number": {
          const res = setRuntimeNumber(current, step.field, step.value);
          if (res.error) throw new Error(res.error);
          current = res.draft;
          break;
        }
        case "set-runtime-text": {
          const res = setRuntimeText(current, step.field, step.value);
          if (res.error) throw new Error(res.error);
          current = res.draft;
          break;
        }
        default:
          throw new Error(`unknown editor action: ${step.action}`);
      }
    }
    return { action: "cancel", draft: current };
  };
}
