import {
  createEditorDraft,
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
  toSavePayload,
  validateRuntimeNumber,
} from "../src/config-editor.js";
import { defaultStormConfig } from "../src/config.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

const defaults = defaultStormConfig();

// 1. createEditorDraft deep-copies config and carries extra keys.
{
  const config = {
    lmModels: { conv_simulator_lm: "anthropic/claude-sonnet-4-5", question_asker_lm: null, outline_gen_lm: null, article_gen_lm: null, article_polish_lm: null },
    retriever: { backend: "you", settings: {} },
    stageFlags: { doResearch: true, doGenerateOutline: true, doGenerateArticle: true, doPolishArticle: true },
    runtime: { outputRoot: "/tmp/out", python: "python3", maxConvTurn: 3, maxPerspective: 3, maxSearchQueriesPerTurn: 3, searchTopK: 3, retrieveTopK: 3, maxThreadNum: 10 },
  };
  const draft = createEditorDraft(config, { customFuture: 1 });
  check("draft copies lmModels", draft.lmModels.conv_simulator_lm === "anthropic/claude-sonnet-4-5");
  check("draft carries extra keys", draft.extra.customFuture === 1);
  check("draft is independent of input", draft.lmModels !== config.lmModels);
}

// 2. setModel updates a role immutably.
{
  const draft = createEditorDraft(defaults);
  const next = setModel(draft, "conv_simulator_lm", "openai/gpt-5");
  check("setModel updates role", next.lmModels.conv_simulator_lm === "openai/gpt-5");
  check("setModel returns new draft", next !== draft);
  check("setModel is immutable", draft.lmModels.conv_simulator_lm === null);
}

// 3. clearModel sets a role to null.
{
  const draft = createEditorDraft(defaults);
  draft.lmModels.conv_simulator_lm = "x/y";
  const next = clearModel(draft, "conv_simulator_lm");
  check("clearModel sets null", next.lmModels.conv_simulator_lm === null);
}

// 4. setRetrieverBackend / clearRetriever.
{
  const draft = createEditorDraft(defaults);
  const next = setRetrieverBackend(draft, "you");
  check("setRetrieverBackend updates backend", next.retriever.backend === "you");
  const cleared = clearRetriever(next);
  check("clearRetriever sets null", cleared.retriever.backend === null);
}

// 5. setRetrieverSetting updates a backend setting immutably.
{
  const draft = createEditorDraft(defaults);
  const withBackend = setRetrieverBackend(draft, "searxng");
  const next = setRetrieverSetting(withBackend, "apiUrl", "https://searxng.example.com");
  check("setRetrieverSetting updates setting", next.retriever.settings.apiUrl === "https://searxng.example.com");
  check("setRetrieverSetting is immutable", withBackend.retriever.settings.apiUrl !== "https://searxng.example.com");
}

// 6. toggleStage flips a stage flag.
{
  const draft = createEditorDraft(defaults);
  check("toggleStage on->off", toggleStage(draft, "doResearch").stageFlags.doResearch === false);
  check("toggleStage off->on", toggleStage(toggleStage(draft, "doResearch"), "doResearch").stageFlags.doResearch === true);
}

// 7. setStage sets a stage flag.
{
  const draft = createEditorDraft(defaults);
  check("setStage false", setStage(draft, "doPolishArticle", false).stageFlags.doPolishArticle === false);
}

// 8. setRuntimeNumber updates valid numbers immutably.
{
  const draft = createEditorDraft(defaults);
  const next = setRuntimeNumber(draft, "maxConvTurn", 7);
  check("setRuntimeNumber updates value", next.draft.runtime.maxConvTurn === 7);
  check("setRuntimeNumber immutable", draft.runtime.maxConvTurn === 3);
}

// 9. setRuntimeNumber rejects invalid values.
{
  const draft = createEditorDraft(defaults);
  const result = setRuntimeNumber(draft, "maxConvTurn", 0);
  check("setRuntimeNumber rejects 0", result.draft === draft && result.error !== null);
  const negative = setRuntimeNumber(draft, "maxConvTurn", -1);
  check("setRuntimeNumber rejects negative", negative.error !== null);
  const nan = setRuntimeNumber(draft, "maxConvTurn", 3.5);
  check("setRuntimeNumber rejects non-integer", nan.error !== null);
}

// 10. setRuntimeText rejects empty, accepts non-empty.
{
  const draft = createEditorDraft(defaults);
  const empty = setRuntimeText(draft, "outputRoot", "");
  check("setRuntimeText rejects empty", empty.error !== null);
  const ok = setRuntimeText(draft, "outputRoot", "/tmp/new");
  check("setRuntimeText accepts non-empty", ok.draft.runtime.outputRoot === "/tmp/new");
}

// 11. resetDraftToDefaults resets whole draft.
{
  const draft = createEditorDraft(defaults);
  draft.lmModels.conv_simulator_lm = "x/y";
  draft.runtime.maxConvTurn = 9;
  const next = resetDraftToDefaults(draft, defaults);
  check("reset clears model", next.lmModels.conv_simulator_lm === null);
  check("reset restores runtime default", next.runtime.maxConvTurn === defaults.runtime.maxConvTurn);
}

// 12. toSavePayload returns known structure and merges extra keys.
{
  const config = {
    lmModels: { conv_simulator_lm: "anthropic/claude-sonnet-4-5", question_asker_lm: null, outline_gen_lm: null, article_gen_lm: null, article_polish_lm: null },
    retriever: { backend: "you", settings: {} },
    stageFlags: { doResearch: true, doGenerateOutline: true, doGenerateArticle: true, doPolishArticle: true },
    runtime: { outputRoot: "/tmp/out", python: "python3", maxConvTurn: 3, maxPerspective: 3, maxSearchQueriesPerTurn: 3, searchTopK: 3, retrieveTopK: 3, maxThreadNum: 10 },
  };
  const draft = createEditorDraft(config, { customFuture: 1 });
  const payload = toSavePayload(draft);
  check("payload has lmModels", payload.lmModels.conv_simulator_lm === "anthropic/claude-sonnet-4-5");
  check("payload has retriever", payload.retriever.backend === "you");
  check("payload has stageFlags", payload.stageFlags.doResearch === true);
  check("payload has runtime", payload.runtime.outputRoot === "/tmp/out");
  check("payload preserves extra key", payload.customFuture === 1);
}

// 13. validateRuntimeNumber matches config-layer positive-integer rule.
{
  check("validates 3", validateRuntimeNumber(3) === true);
  check("rejects 0", validateRuntimeNumber(0) === false);
  check("rejects negative", validateRuntimeNumber(-2) === false);
  check("rejects non-integer", validateRuntimeNumber(2.5) === false);
}
