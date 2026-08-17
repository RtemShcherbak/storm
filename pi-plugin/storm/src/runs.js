import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { getStormAgentDir, loadStormConfig } from "./config.js";
import { launchManagedStormProcess, getStormWorkspaceRoot } from "./process.js";

export const STORM_RUN_POINTER_FILE = "storm-run.json";

export function defaultStormRunPointer() {
  return { currentRunDir: null };
}

export function getStormRunPointerPath(agentDir = getStormAgentDir()) {
  return join(agentDir, STORM_RUN_POINTER_FILE);
}

function normalizeRunDirPath(runDir) {
  if (typeof runDir !== "string") return null;
  const trimmed = runDir.trim();
  return trimmed ? resolve(trimmed) : null;
}

export function normalizeStormTopic(topic) {
  const slug = String(topic ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "storm";
}

export function formatStormRunTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + "-" + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
}

export function buildStormRunDirectoryName(topic, options = {}) {
  const now = options.now ?? new Date();
  const id = options.id ?? randomBytes(2).toString("hex");
  return `${normalizeStormTopic(topic)}-${formatStormRunTimestamp(now)}-${id}`;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadStormRunPointer(agentDir = getStormAgentDir()) {
  try {
    const raw = JSON.parse(await readFile(getStormRunPointerPath(agentDir), "utf8"));
    return {
      currentRunDir: normalizeRunDirPath(raw?.currentRunDir),
    };
  } catch {
    return defaultStormRunPointer();
  }
}

export async function saveStormRunPointer(pointer, agentDir = getStormAgentDir()) {
  const currentRunDir = normalizeRunDirPath(pointer?.currentRunDir);
  const path = getStormRunPointerPath(agentDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ currentRunDir }, null, 2)}\n`, "utf8");
  return { currentRunDir };
}

export async function clearStormRunPointer(agentDir = getStormAgentDir()) {
  return saveStormRunPointer(defaultStormRunPointer(), agentDir);
}

export async function createStormRunDirectory(config, topic, options = {}) {
  const outputRoot = resolve(config.runtime.outputRoot);
  const now = options.now;
  const idFactory = options.idFactory ?? (() => randomBytes(2).toString("hex"));
  await mkdir(outputRoot, { recursive: true });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const runDir = join(outputRoot, buildStormRunDirectoryName(topic, { now, id: idFactory() }));
    try {
      await mkdir(runDir);
      return runDir;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to create a unique STORM run directory");
}

export function parseRunRequest(args, fallbackTopic = "Alpha Topic") {
  const trimmed = typeof args === "string" ? args.trim() : "";
  let topic = trimmed;
  let groundTruthUrl;
  const urlMatch = trimmed.match(/\s+--ground-truth-url=(\S+)/);
  if (urlMatch) {
    groundTruthUrl = urlMatch[1];
    topic = trimmed.slice(0, urlMatch.index).trim();
  }
  return {
    topic: topic || fallbackTopic,
    ...(groundTruthUrl ? { groundTruthUrl } : {}),
  };
}

async function resolveExplicitRunDir(args) {
  const trimmed = typeof args === "string" ? args.trim() : "";
  return trimmed ? normalizeRunDirPath(trimmed) : null;
}

async function loadSelectedRunDir(agentDir, args, ctx) {
  const explicit = await resolveExplicitRunDir(args);
  if (explicit) return { runDir: explicit, source: "explicit" };
  const pointer = await loadStormRunPointer(agentDir);
  if (pointer.currentRunDir) return { runDir: pointer.currentRunDir, source: "pointer" };
  const answer = await ctx.ui.input("Existing STORM artifact directory", "");
  const selected = normalizeRunDirPath(answer);
  return selected ? { runDir: selected, source: "prompt" } : { runDir: null, source: "prompt" };
}

export async function runStormStartCommand(ctx, args = "", options = {}) {
  if (!ctx || !ctx.ui) throw new Error("storm-start requires a UI-capable Pi context");
  const agentDir = options.agentDir ?? getStormAgentDir();
  const config = await loadStormConfig(agentDir);
  const parsed = parseRunRequest(args, "");
  const request = {
    topic: parsed.topic || (await ctx.ui.input("STORM topic", ""))?.trim() || "storm",
    ...(parsed.groundTruthUrl ? { groundTruthUrl: parsed.groundTruthUrl } : {}),
  };
  if (options.groundTruthUrl) request.groundTruthUrl = options.groundTruthUrl;
  const runDir = await createStormRunDirectory(config, request.topic, options);
  await saveStormRunPointer({ currentRunDir: runDir }, agentDir);
  ctx.ui.notify(`Created STORM run directory: ${runDir}`, "info");

  const launcher = options.launcher ?? launchManagedStormProcess;
  const launched = launcher({
    config,
    runDir,
    request,
    workspaceRoot: options.workspaceRoot ?? getStormWorkspaceRoot(),
    ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
  });

  return { runDir, request, outcome: launched.outcome, child: launched.child ?? null };
}

export async function runStormResumeCommand(ctx, args = "", options = {}) {
  if (!ctx || !ctx.ui) throw new Error("storm-resume requires a UI-capable Pi context");
  const agentDir = options.agentDir ?? getStormAgentDir();
  const selected = await loadSelectedRunDir(agentDir, args, ctx);

  if (!selected.runDir) {
    await clearStormRunPointer(agentDir);
    ctx.ui.notify("No current STORM run directory selected.", "warning");
    return null;
  }

  if (!(await pathExists(selected.runDir))) {
    if (selected.source === "pointer") {
      await clearStormRunPointer(agentDir);
      ctx.ui.notify(`Cleared stale STORM run pointer: ${selected.runDir}`, "warning");
    } else {
      ctx.ui.notify(`STORM run directory does not exist: ${selected.runDir}`, "error");
    }
    return null;
  }

  await saveStormRunPointer({ currentRunDir: selected.runDir }, agentDir);
  ctx.ui.notify(
    selected.source === "pointer"
      ? `Resuming STORM run directory: ${selected.runDir}`
      : `Selected STORM run directory: ${selected.runDir}`,
    "info",
  );
  return selected.runDir;
}
