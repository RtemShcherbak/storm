export const STORM_RETRIEVERS = Object.freeze({
  you: Object.freeze({
    id: "you",
    label: "You.com",
    credentialEnv: Object.freeze(["YDC_API_KEY"]),
    settings: Object.freeze({}),
    requiredSettings: Object.freeze([]),
  }),
  bing: Object.freeze({
    id: "bing",
    label: "Bing Search",
    credentialEnv: Object.freeze(["BING_SEARCH_API_KEY"]),
    settings: Object.freeze({}),
    requiredSettings: Object.freeze([]),
  }),
  brave: Object.freeze({
    id: "brave",
    label: "Brave Search",
    credentialEnv: Object.freeze(["BRAVE_API_KEY"]),
    settings: Object.freeze({}),
    requiredSettings: Object.freeze([]),
  }),
  serper: Object.freeze({
    id: "serper",
    label: "Serper",
    credentialEnv: Object.freeze(["SERPER_API_KEY"]),
    settings: Object.freeze({}),
    requiredSettings: Object.freeze([]),
  }),
  tavily: Object.freeze({
    id: "tavily",
    label: "Tavily",
    credentialEnv: Object.freeze(["TAVILY_API_KEY"]),
    settings: Object.freeze({}),
    requiredSettings: Object.freeze([]),
  }),
  duckduckgo: Object.freeze({
    id: "duckduckgo",
    label: "DuckDuckGo",
    credentialEnv: Object.freeze([]),
    settings: Object.freeze({ safeSearch: "On", region: "us-en" }),
    requiredSettings: Object.freeze([]),
  }),
  searxng: Object.freeze({
    id: "searxng",
    label: "SearXNG",
    credentialEnv: Object.freeze(["SEARXNG_API_KEY"]),
    settings: Object.freeze({ apiUrl: "" }),
    requiredSettings: Object.freeze(["apiUrl"]),
  }),
  azure_ai_search: Object.freeze({
    id: "azure_ai_search",
    label: "Azure AI Search",
    credentialEnv: Object.freeze(["AZURE_AI_SEARCH_API_KEY"]),
    settings: Object.freeze({ url: "", indexName: "" }),
    requiredSettings: Object.freeze(["url", "indexName"]),
  }),
});

export function defaultStormRetriever() {
  return { backend: null, settings: {} };
}

export function listStormRetrievers() {
  return Object.values(STORM_RETRIEVERS);
}

export function getStormRetrieverDef(backend) {
  return STORM_RETRIEVERS[backend] ?? null;
}

function normalizeSetting(def, key, value) {
  if (typeof value !== "string") return def.settings[key] ?? "";
  return value.trim() || "";
}

export function normalizeStormRetriever(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const def = getStormRetrieverDef(source.backend);
  if (!def) {
    return { backend: null, settings: {} };
  }
  const settingsRaw = source.settings && typeof source.settings === "object" ? source.settings : {};
  const settings = {};
  for (const key of Object.keys(def.settings)) {
    settings[key] = normalizeSetting(def, key, settingsRaw[key]);
  }
  return { backend: def.id, settings };
}

export function missingRetrieverCredentials(def, env) {
  if (!def) return [];
  return def.credentialEnv.filter((name) => !env[name]);
}

export function missingRetrieverSettings(def, settings) {
  if (!def) return [];
  return def.requiredSettings.filter((key) => !settings[key]);
}
