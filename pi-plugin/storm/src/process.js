import { spawn as nodeSpawn } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STORM_INLINE_SCRIPT = [
  "import os",
  "import knowledge_storm",
  "print('Managed STORM process ready')",
  "print(os.getcwd())",
].join("; ");

let processSpawner = defaultProcessSpawner;

function moduleRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
}

export function getStormWorkspaceRoot() {
  return moduleRoot();
}

export function buildStormProcessInvocation(config, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? getStormWorkspaceRoot();
  return {
    command: config.runtime.python,
    args: ["-c", STORM_INLINE_SCRIPT],
    options: {
      cwd: workspaceRoot,
      runDir: options.runDir ?? null,
      env: {
        ...process.env,
        PYTHONPATH: [workspaceRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      },
    },
  };
}

export function buildStormRunRequest(runRequest) {
  return {
    topic: runRequest?.topic ?? null,
    groundTruthUrl: runRequest?.groundTruthUrl ?? null,
  };
}

function defaultProcessSpawner(invocation) {
  return nodeSpawn(invocation.command, invocation.args, {
    cwd: invocation.options.cwd,
    env: invocation.options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function setStormProcessSpawnerForTesting(spawnImpl) {
  processSpawner = typeof spawnImpl === "function" ? spawnImpl : defaultProcessSpawner;
}

function bufferToString(chunk) {
  return typeof chunk === "string" ? chunk : chunk?.toString?.("utf8") ?? "";
}

function buildDiagnostics() {
  return { stdout: "", stderr: "" };
}

function createOutcomeHandle(kind, base, extra = {}) {
  return {
    kind,
    ...base,
    ...extra,
  };
}

export function launchManagedStormProcess({ config, runDir, request, workspaceRoot, spawnProcess } = {}) {
  const invocation = buildStormProcessInvocation(config, { workspaceRoot, runDir });
  const diagnostics = buildDiagnostics();
  const spawnImpl = spawnProcess ?? processSpawner;
  let child = null;
  let spawned = false;
  let settled = false;
  let resolveOutcome;
  const outcome = new Promise((resolve) => {
    resolveOutcome = resolve;
  });

  function settle(result) {
    if (settled) return;
    settled = true;
    resolveOutcome(
      createOutcomeHandle(result.kind, {
        runDir,
        request: buildStormRunRequest(request),
        command: invocation.command,
        args: invocation.args,
        cwd: invocation.options.cwd,
        diagnostics: { ...diagnostics },
      }, result),
    );
  }

  try {
    child = spawnImpl(invocation);
  } catch (error) {
    settle({ kind: "start-failure", error });
    return { child: null, invocation, outcome };
  }

  const stdout = child?.stdout;
  const stderr = child?.stderr;
  stdout?.on?.("data", (chunk) => {
    diagnostics.stdout += bufferToString(chunk);
  });
  stderr?.on?.("data", (chunk) => {
    diagnostics.stderr += bufferToString(chunk);
  });

  child?.once?.("spawn", () => {
    spawned = true;
  });

  child?.once?.("error", (error) => {
    if (!spawned) {
      settle({ kind: "start-failure", error });
      return;
    }
    try {
      child?.kill?.();
    } catch {
      // The process is already in a failed state; best effort cleanup only.
    }
    settle({ kind: "runtime-failure", error, exitCode: null, signal: null });
  });

  child?.once?.("close", (exitCode, signal) => {
    if (exitCode === 0) {
      settle({ kind: "success", exitCode, signal });
      return;
    }
    settle({ kind: "runtime-failure", exitCode, signal, error: null });
  });

  return { child, invocation, outcome };
}
