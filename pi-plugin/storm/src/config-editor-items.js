import { STORM_LM_ROLES, stormModelRoleLabel } from "./models.js";
import { getStormRetrieverDef, missingRetrieverCredentials } from "./retrievers.js";
import { STAGE_FIELDS } from "./config-editor.js";

export const RUNTIME_NUMERIC = [
  ["maxConvTurn", "Max conversation turns", "Maximum conversation turns in research (STORM default 3)."],
  ["maxPerspective", "Max perspectives", "Number of perspectives per conversation turn (STORM default 3)."],
  ["maxSearchQueriesPerTurn", "Max search queries per turn", "Search queries issued per turn (STORM default 3)."],
  ["searchTopK", "Search top-k", "Top-k search results per query (STORM default 3)."],
  ["retrieveTopK", "Retrieve top-k", "Top-k collected references per section (STORM default 3)."],
  ["maxThreadNum", "Max thread num", "Maximum worker threads (STORM default 10)."],
];

export const RUNTIME_TEXT = [
  ["outputRoot", "Output root", "Directory where run artifact folders are created (STORM default ./results/gpt)."],
  ["python", "Python command", "Python executable used for out-of-process STORM runs (default python3)."],
];

/**
 * Build the flat SettingsList items for the config editor.
 * Pure and exported so tests can assert on the SettingsList contract (action rows
 * must carry non-empty `values` or the real SettingsList.activateItem never fires
 * onChange for them — the Save/Cancel/Reset actions become unreachable).
 */
export function buildEditorItems(edited, { env = process.env, errorMessage = null } = {}) {
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
  items.push({ id: "__reset__", label: "Reset to defaults", currentValue: "reset", values: ["reset"], description: "Reset the whole draft to STORM defaults" });
  items.push({ id: "__save__", label: "Save & close", currentValue: "save", values: ["save"], description: "Save the whole draft and close" });
  items.push({ id: "__cancel__", label: "Cancel", currentValue: "cancel", values: ["cancel"], description: "Discard edits and close" });
  return items;
}
