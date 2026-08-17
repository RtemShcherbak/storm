export const STORM_LM_ROLE_ORDER = [
  "conv_simulator_lm",
  "question_asker_lm",
  "outline_gen_lm",
  "article_gen_lm",
  "article_polish_lm",
];

/**
 * Resolved Pi-to-STORM LM adapter decision.
 *
 * A selected Pi model reference ("provider/id") maps to a STORM LM role by
 * constructing a LiteLLM model (`LitellmModel(model=<ref>)`) and assigning it
 * to the corresponding field on `STORMWikiLMConfigs`. Credentials stay under Pi
 * provider auth (LiteLLM reads provider env keys); no key is stored in config.
 *
 * Role separation is preserved: each of the five roles is assigned independently.
 * An unset/invalid role ref is an incompatibility that blocks launch (never a
 * silent fallback).
 */
export function buildLmAdapterSeam(lmModels) {
  const source = lmModels ?? {};
  const modelRefs = {};
  const missingRoles = [];
  for (const role of STORM_LM_ROLE_ORDER) {
    const ref = source[role];
    if (typeof ref === "string" && ref.trim()) {
      modelRefs[role] = ref.trim();
    } else {
      missingRoles.push(role);
    }
  }
  return { modelRefs, missingRoles };
}
