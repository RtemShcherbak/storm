export const STORM_LM_ROLES = Object.freeze([
  "conv_simulator_lm",
  "question_asker_lm",
  "outline_gen_lm",
  "article_gen_lm",
  "article_polish_lm",
]);

export const STORM_LM_ROLE_LABELS = Object.freeze({
  conv_simulator_lm: "Conversation simulator LM",
  question_asker_lm: "Question asker LM",
  outline_gen_lm: "Outline generator LM",
  article_gen_lm: "Article generator LM",
  article_polish_lm: "Article polish LM",
});

export function defaultStormLmModels() {
  return {
    conv_simulator_lm: null,
    question_asker_lm: null,
    outline_gen_lm: null,
    article_gen_lm: null,
    article_polish_lm: null,
  };
}

function normalizeModelRef(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeStormLmModels(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    conv_simulator_lm: normalizeModelRef(source.conv_simulator_lm),
    question_asker_lm: normalizeModelRef(source.question_asker_lm),
    outline_gen_lm: normalizeModelRef(source.outline_gen_lm),
    article_gen_lm: normalizeModelRef(source.article_gen_lm),
    article_polish_lm: normalizeModelRef(source.article_polish_lm),
  };
}

export function stormModelRef(model) {
  return model ? `${model.provider}/${model.id}` : undefined;
}

export function parseStormModelRef(ref) {
  if (typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return {
    provider: trimmed.slice(0, slash),
    id: trimmed.slice(slash + 1),
  };
}

export function stormModelRoleLabel(role) {
  return STORM_LM_ROLE_LABELS[role] ?? role;
}

export function availableStormModelRefs(models) {
  return [...models].map(stormModelRef).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function describeStormModelRef(registry, availableRefs, ref) {
  const parsed = parseStormModelRef(ref);
  if (!parsed) {
    return { state: ref ? "invalid" : "unset", ref: ref ?? null };
  }
  const normalizedRef = `${parsed.provider}/${parsed.id}`;
  const found = registry.find(parsed.provider, parsed.id);
  if (!found) return { state: "missing", ref: normalizedRef };
  return { state: availableRefs.includes(normalizedRef) ? "available" : "unavailable", ref: normalizedRef };
}
