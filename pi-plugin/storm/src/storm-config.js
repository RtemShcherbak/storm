import { defaultStormConfig, loadStormConfig, saveStormConfig } from "./config.js";
import { promptStormLmModels } from "./lm-config.js";
import { promptStormRetriever } from "./retriever-config.js";
import { normalizeCommandContext, promptNumber, promptText, promptToggle } from "./prompt.js";

export async function runStormConfigCommand(ctx, options = {}) {
  const commandContext = normalizeCommandContext(ctx);
  const agentDir = options.agentDir;
  const current = await loadStormConfig(agentDir);
  const base = current ?? defaultStormConfig();

  const runtime = {
    outputRoot: await promptText(commandContext, "STORM output root", base.runtime.outputRoot),
    python: await promptText(commandContext, "Python executable/command", base.runtime.python),
    maxConvTurn: await promptNumber(commandContext, "Max conversation turns", base.runtime.maxConvTurn),
    maxPerspective: await promptNumber(commandContext, "Max perspectives", base.runtime.maxPerspective),
    maxSearchQueriesPerTurn: await promptNumber(commandContext, "Max search queries per turn", base.runtime.maxSearchQueriesPerTurn),
    searchTopK: await promptNumber(commandContext, "Search top-k", base.runtime.searchTopK),
    retrieveTopK: await promptNumber(commandContext, "Retrieve top-k", base.runtime.retrieveTopK),
    maxThreadNum: await promptNumber(commandContext, "Max thread num", base.runtime.maxThreadNum),
  };

  const stageFlags = {
    doResearch: await promptToggle(commandContext, "Enable research stage", base.stageFlags.doResearch),
    doGenerateOutline: await promptToggle(commandContext, "Enable outline stage", base.stageFlags.doGenerateOutline),
    doGenerateArticle: await promptToggle(commandContext, "Enable article stage", base.stageFlags.doGenerateArticle),
    doPolishArticle: await promptToggle(commandContext, "Enable polish stage", base.stageFlags.doPolishArticle),
  };

  const lmModels = await promptStormLmModels(commandContext, base.lmModels);

  const retriever = await promptStormRetriever(commandContext, base.retriever);

  const saved = await saveStormConfig({ lmModels, retriever, stageFlags, runtime }, agentDir);
  commandContext.ui.notify("Saved /storm-config", "info");
  return saved;
}

export default runStormConfigCommand;
