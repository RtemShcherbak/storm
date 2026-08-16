import { defaultStormConfig, loadStormConfig, saveStormConfig } from "./config.js";
import { promptStormLmModels } from "./lm-config.js";

function normalizeCommandContext(ctx) {
  if (!ctx || !ctx.ui) {
    throw new Error("storm-config requires a UI-capable Pi context");
  }
  return ctx;
}

async function promptText(ctx, label, current) {
  const answer = await ctx.ui.input(label, current);
  if (typeof answer !== "string") return current;
  const trimmed = answer.trim();
  return trimmed ? trimmed : current;
}

async function promptToggle(ctx, label, current) {
  const answer = await ctx.ui.input(label, current ? "on" : "off");
  if (typeof answer !== "string") return current;
  const normalized = answer.trim().toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "off" || normalized === "false" || normalized === "no") return false;
  return current;
}

async function promptNumber(ctx, label, current) {
  const answer = await ctx.ui.input(label, String(current));
  if (typeof answer !== "string") return current;
  const parsed = Number.parseInt(answer.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : current;
}

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

  const saved = await saveStormConfig({ lmModels, stageFlags, runtime }, agentDir);
  commandContext.ui.notify("Saved /storm-config", "info");
  return saved;
}

export default runStormConfigCommand;
