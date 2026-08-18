import {
  defaultStormRetriever,
  getStormRetrieverDef,
  listStormRetrievers,
  missingRetrieverCredentials,
  missingRetrieverSettings,
  normalizeStormRetriever,
} from "../src/retrievers.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

const defaults = defaultStormRetriever();
check("default retriever backend is unset (no magic default)", defaults.backend === null);
check("default retriever has empty settings", Object.keys(defaults.settings).length === 0);

check("known backends are enumerated", listStormRetrievers().length > 0);
check("known backend resolves to a definition", getStormRetrieverDef("you")?.id === "you");
check("unknown backend resolves to null", getStormRetrieverDef("not-a-backend") === null);

const normalized = normalizeStormRetriever({
  backend: "you",
  settings: { apiKey: "secret-should-drop", other: "ignored" },
});
check("normalize keeps selected backend", normalized.backend === "you");
check("normalize drops unknown/secret settings", Object.keys(normalized.settings).length === 0);

const searxng = normalizeStormRetriever({
  backend: "searxng",
  settings: { apiUrl: "https://searxng.example.com", apiKey: "secret" },
});
check("normalize keeps backend-specific non-secret settings", searxng.settings.apiUrl === "https://searxng.example.com");
check("normalize drops credential from settings", !Object.hasOwn(searxng.settings, "apiKey"));

const azure = normalizeStormRetriever({
  backend: "azure_ai_search",
  settings: { url: "https://search.example", indexName: "idx", apiKey: "secret" },
});
check("azure non-secret settings persist", azure.settings.url === "https://search.example" && azure.settings.indexName === "idx");
check("azure credential is dropped", !Object.hasOwn(azure.settings, "apiKey"));

check("unknown backend id normalizes to null", normalizeStormRetriever({ backend: "nope" }).backend === null);

const youDef = getStormRetrieverDef("you");
check("you credential requirement is surfaced", missingRetrieverCredentials(youDef, {})[0] === "YDC_API_KEY");
check("you is ready when credential present", missingRetrieverCredentials(youDef, { YDC_API_KEY: "x" }).length === 0);

const duckDef = getStormRetrieverDef("duckduckgo");
check("duckduckgo requires no credential", missingRetrieverCredentials(duckDef, {}).length === 0);

const searxngDef = getStormRetrieverDef("searxng");
check("searxng missing non-secret param is surfaced", missingRetrieverSettings(searxngDef, {}).includes("apiUrl"));
check("searxng ready when param present", missingRetrieverSettings(searxngDef, { apiUrl: "x" }).length === 0);

