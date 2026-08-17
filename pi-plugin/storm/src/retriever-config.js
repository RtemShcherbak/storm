import {
  defaultStormRetriever,
  getStormRetrieverDef,
  listStormRetrievers,
  missingRetrieverCredentials,
  missingRetrieverSettings,
} from "./retrievers.js";
import { normalizeCommandContext, promptText } from "./prompt.js";

export async function promptStormRetriever(ctx, currentRetriever) {
  const commandContext = normalizeCommandContext(ctx);
  const current = currentRetriever ?? defaultStormRetriever();
  const defs = listStormRetrievers();
  const currentBackend = current.backend;

  const choices = [
    `keep current${currentBackend ? ` (${currentBackend})` : " (none)"}`,
    "none",
    ...defs.map((def) => def.id),
  ];
  const selected = await commandContext.ui.select("Choose STORM retriever backend", choices);

  let backend = currentBackend;
  if (typeof selected === "string" && selected !== "none" && !selected.startsWith("keep current")) {
    backend = getStormRetrieverDef(selected) ? selected : currentBackend;
  } else if (selected === "none") {
    backend = null;
  }

  const def = backend ? getStormRetrieverDef(backend) : null;
  const settings = { ...(current.settings ?? {}) };
  if (def) {
    for (const key of Object.keys(def.settings)) {
      settings[key] = await promptText(commandContext, `${def.label} ${key}`, settings[key] ?? "");
    }
    const missingCreds = missingRetrieverCredentials(def, process.env);
    const missingParams = missingRetrieverSettings(def, settings);
    if (missingCreds.length > 0 || missingParams.length > 0) {
      const parts = [
        ...missingCreds.map((name) => `credential ${name}`),
        ...missingParams.map((name) => `setting ${name}`),
      ];
      commandContext.ui.notify(
        `STORM retriever ${def.label} missing: ${parts.join(", ")}`,
        "warning",
      );
    } else {
      commandContext.ui.notify(`STORM retriever ${def.label} ready`, "info");
    }
  }

  return { backend, settings };
}
