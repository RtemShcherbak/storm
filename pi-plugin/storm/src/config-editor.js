import { defaultStormConfig } from "./config.js";

export const KNOWN_TOP_LEVEL_KEYS = Object.freeze([
  "lmModels",
  "retriever",
  "stageFlags",
  "runtime",
]);

const RUNTIME_NUMERIC_FIELDS = Object.freeze([
  "maxConvTurn",
  "maxPerspective",
  "maxSearchQueriesPerTurn",
  "searchTopK",
  "retrieveTopK",
  "maxThreadNum",
]);

const RUNTIME_TEXT_FIELDS = Object.freeze(["outputRoot", "python"]);

const STAGE_FIELDS = Object.freeze([
  "doResearch",
  "doGenerateOutline",
  "doGenerateArticle",
  "doPolishArticle",
]);

/**
 * Validate a runtime numeric field value against the config layer's
 * positive-integer rule. This is the single source of truth; UI ranges are not
 * duplicated.
 */
export function validateRuntimeNumber(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function cloneModelRefs(lmModels) {
  return {
    conv_simulator_lm: lmModels?.conv_simulator_lm ?? null,
    question_asker_lm: lmModels?.question_asker_lm ?? null,
    outline_gen_lm: lmModels?.outline_gen_lm ?? null,
    article_gen_lm: lmModels?.article_gen_lm ?? null,
    article_polish_lm: lmModels?.article_polish_lm ?? null,
  };
}

function cloneRetriever(retriever) {
  return {
    backend: retriever?.backend ?? null,
    settings: { ...(retriever?.settings ?? {}) },
  };
}

function cloneStageFlags(stageFlags) {
  return {
    doResearch: stageFlags?.doResearch ?? true,
    doGenerateOutline: stageFlags?.doGenerateOutline ?? true,
    doGenerateArticle: stageFlags?.doGenerateArticle ?? true,
    doPolishArticle: stageFlags?.doPolishArticle ?? true,
  };
}

function cloneRuntime(runtime) {
  const out = {};
  for (const field of RUNTIME_NUMERIC_FIELDS) {
    out[field] = runtime?.[field];
  }
  for (const field of RUNTIME_TEXT_FIELDS) {
    out[field] = runtime?.[field];
  }
  return out;
}

/**
 * Create an immutable editor draft from a config, carrying unknown/extra
 * top-level keys so a round-trip does not silently drop them.
 */
export function createEditorDraft(config, extra = {}) {
  return {
    lmModels: cloneModelRefs(config?.lmModels),
    retriever: cloneRetriever(config?.retriever),
    stageFlags: cloneStageFlags(config?.stageFlags),
    runtime: cloneRuntime(config?.runtime),
    extra: { ...extra },
  };
}

function withModelRefs(draft, fn) {
  return { ...draft, lmModels: fn(draft.lmModels) };
}

export function setModel(draft, role, ref) {
  return withModelRefs(draft, (models) => ({ ...models, [role]: ref }));
}

export function clearModel(draft, role) {
  return withModelRefs(draft, (models) => ({ ...models, [role]: null }));
}

export function setRetrieverBackend(draft, backend) {
  return { ...draft, retriever: { ...draft.retriever, backend } };
}

export function clearRetriever(draft) {
  return setRetrieverBackend(draft, null);
}

export function setRetrieverSetting(draft, key, value) {
  return {
    ...draft,
    retriever: { ...draft.retriever, settings: { ...draft.retriever.settings, [key]: value } },
  };
}

export function setStage(draft, field, value) {
  return { ...draft, stageFlags: { ...draft.stageFlags, [field]: value } };
}

export function toggleStage(draft, field) {
  return setStage(draft, field, !draft.stageFlags[field]);
}

export function setRuntimeText(draft, field, value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return { draft, error: `${field} must be a non-empty value` };
  }
  return { draft: { ...draft, runtime: { ...draft.runtime, [field]: trimmed } }, error: null };
}

export function setRuntimeNumber(draft, field, value) {
  if (!validateRuntimeNumber(value)) {
    return { draft, error: `${field} must be a positive integer` };
  }
  return { draft: { ...draft, runtime: { ...draft.runtime, [field]: value } }, error: null };
}

export function resetDraftToDefaults(draft, defaults = defaultStormConfig()) {
  const base = defaults ?? defaultStormConfig();
  return {
    lmModels: cloneModelRefs(base.lmModels),
    retriever: cloneRetriever(base.retriever),
    stageFlags: cloneStageFlags(base.stageFlags),
    runtime: cloneRuntime(base.runtime),
    extra: { ...(draft?.extra ?? {}) },
  };
}

/**
 * Build the payload to persist: known fields plus any unknown/extra top-level
 * keys preserved from the loaded config.
 */
export function toSavePayload(draft) {
  return {
    ...(draft.extra ?? {}),
    lmModels: { ...draft.lmModels },
    retriever: { ...draft.retriever, settings: { ...draft.retriever.settings } },
    stageFlags: { ...draft.stageFlags },
    runtime: { ...draft.runtime },
  };
}

export { RUNTIME_NUMERIC_FIELDS, RUNTIME_TEXT_FIELDS, STAGE_FIELDS };
