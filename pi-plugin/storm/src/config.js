import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const STORM_CONFIG_FILE = "storm.json";

export function getStormAgentDir() {
  return process.env.PI_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

export function getStormConfigPath(agentDir = getStormAgentDir()) {
  return join(agentDir, STORM_CONFIG_FILE);
}

export function defaultStormConfig() {
  return {
    stageFlags: {
      doResearch: true,
      doGenerateOutline: true,
      doGenerateArticle: true,
      doPolishArticle: true,
    },
    runtime: {
      outputRoot: "./results/gpt",
      python: "python3",
      maxConvTurn: 3,
      maxPerspective: 3,
      maxSearchQueriesPerTurn: 3,
      searchTopK: 3,
      retrieveTopK: 3,
      maxThreadNum: 10,
    },
  };
}

function normalizeToggle(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "off" || normalized === "false" || normalized === "no") return false;
  return fallback;
}

function normalizePositiveInteger(value, fallback) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonEmptyString(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

export function normalizeStormConfig(raw) {
  const defaults = defaultStormConfig();
  const source = raw && typeof raw === "object" ? raw : {};
  const stageFlagsRaw = source.stageFlags && typeof source.stageFlags === "object" ? source.stageFlags : {};
  const runtimeRaw = source.runtime && typeof source.runtime === "object" ? source.runtime : {};

  return {
    stageFlags: {
      doResearch: normalizeToggle(stageFlagsRaw.doResearch, defaults.stageFlags.doResearch),
      doGenerateOutline: normalizeToggle(stageFlagsRaw.doGenerateOutline, defaults.stageFlags.doGenerateOutline),
      doGenerateArticle: normalizeToggle(stageFlagsRaw.doGenerateArticle, defaults.stageFlags.doGenerateArticle),
      doPolishArticle: normalizeToggle(stageFlagsRaw.doPolishArticle, defaults.stageFlags.doPolishArticle),
    },
    runtime: {
      outputRoot: normalizeNonEmptyString(runtimeRaw.outputRoot, defaults.runtime.outputRoot),
      python: normalizeNonEmptyString(runtimeRaw.python, defaults.runtime.python),
      maxConvTurn: normalizePositiveInteger(runtimeRaw.maxConvTurn, defaults.runtime.maxConvTurn),
      maxPerspective: normalizePositiveInteger(runtimeRaw.maxPerspective, defaults.runtime.maxPerspective),
      maxSearchQueriesPerTurn: normalizePositiveInteger(runtimeRaw.maxSearchQueriesPerTurn, defaults.runtime.maxSearchQueriesPerTurn),
      searchTopK: normalizePositiveInteger(runtimeRaw.searchTopK, defaults.runtime.searchTopK),
      retrieveTopK: normalizePositiveInteger(runtimeRaw.retrieveTopK, defaults.runtime.retrieveTopK),
      maxThreadNum: normalizePositiveInteger(runtimeRaw.maxThreadNum, defaults.runtime.maxThreadNum),
    },
  };
}

function toStoredConfig(config) {
  const normalized = normalizeStormConfig(config);
  return {
    stageFlags: normalized.stageFlags,
    runtime: normalized.runtime,
  };
}

export async function loadStormConfig(agentDir = getStormAgentDir()) {
  try {
    const raw = JSON.parse(await readFile(getStormConfigPath(agentDir), "utf8"));
    return normalizeStormConfig(raw);
  } catch {
    return defaultStormConfig();
  }
}

export async function saveStormConfig(config, agentDir = getStormAgentDir()) {
  const stored = toStoredConfig(config);
  const path = getStormConfigPath(agentDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  return stored;
}
