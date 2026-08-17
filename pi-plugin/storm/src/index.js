export const STORM_STATUS_KEY = "storm";
export const NO_ACTIVE_RUN_STATUS = "○ STORM: no active run";
export const PLACEHOLDER_MESSAGE =
  "Managed STORM run command is not available yet. This shell only registers the command surface for T01.";

export const STORM_COMMANDS = Object.freeze([
  "storm-config",
  "storm-start",
  "storm-resume",
  "storm-cancel",
  "storm-status",
  "storm-artifacts",
]);

const COMMAND_DESCRIPTIONS = Object.freeze({
  "storm-config": "Configure persistent STORM settings.",
  "storm-start": "Create a new run-owned STORM artifact directory.",
  "storm-resume": "Select or resume an existing STORM artifact directory.",
  "storm-cancel": "Cancel the active Managed STORM run.",
  "storm-status": "Show Managed STORM run status.",
  "storm-artifacts": "View Managed STORM run artifacts (placeholder).",
});

function setNoActiveRunStatus(ctx) {
  ctx.ui.setStatus(STORM_STATUS_KEY, NO_ACTIVE_RUN_STATUS);
}

function notifyPlaceholder(ctx) {
  ctx.ui.notify(PLACEHOLDER_MESSAGE, "info");
}

function setLifecycleStatus(ctx, lifecycle) {
  const status = lifecycle.statusText();
  ctx.ui.setStatus(STORM_STATUS_KEY, status === "not_started" ? NO_ACTIVE_RUN_STATUS : `○ STORM: ${status}`);
}

export default async function stormExtension(pi) {
  const { createStormRunLifecycle } = await import("./lifecycle.js");
  const { loadStormConfig } = await import("./config.js");
  const { getStormWorkspaceRoot } = await import("./process.js");
  const { runStormPreflight } = await import("./preflight.js");
  const { inspectStormArtifacts } = await import("./artifacts.js");
  const { cancelActiveStormRun } = await import("./cancel.js");
  const { runStormConfigCommand } = await import("./storm-config.js");
  const { runStormResumeCommand, runStormStartCommand } = await import("./runs.js");
  const lifecycle = createStormRunLifecycle();
  let activeChild = null;

  async function preflightFor(ctx, config) {
    const problems = await runStormPreflight({
      config,
      modelRegistry: ctx.modelRegistry,
      workspaceRoot: getStormWorkspaceRoot(),
    });
    if (problems.length > 0) {
      ctx.ui.notify(
        `STORM preflight failed:\n${problems.map((p) => `- ${p.message}`).join("\n")}`,
        "error",
      );
      return false;
    }
    return true;
  }

  pi.registerCommand("storm-config", {
    description: COMMAND_DESCRIPTIONS["storm-config"],
    handler: async (_args, ctx) => {
      setNoActiveRunStatus(ctx);
      await runStormConfigCommand(ctx);
    },
  });

  pi.registerCommand("storm-start", {
    description: COMMAND_DESCRIPTIONS["storm-start"],
    handler: async (args, ctx) => {
      if (lifecycle.isActive()) {
        ctx.ui.notify(`Cannot start a second STORM run while one is active: ${lifecycle.snapshot().runDir}`, "error");
        return null;
      }
      const agentConfig = await loadStormConfig();
      const ok = await preflightFor(ctx, agentConfig);
      if (!ok) return null;

      const { runDir, outcome, child } = await runStormStartCommand(ctx, args);
      activeChild = child;
      lifecycle.start(runDir, "research");
      setLifecycleStatus(ctx, lifecycle);

      void outcome.then(async (result) => {
        if (lifecycle.snapshot().status === "cancelled") {
          return;
        }
        if (result.kind === "success") {
          lifecycle.setPhase("post_run");
          setLifecycleStatus(ctx, lifecycle);
          const snapshot = await inspectStormArtifacts(runDir);
          if (snapshot.stages.postRun.complete) {
            lifecycle.markCompleted();
          } else {
            lifecycle.markFailed();
          }
          setLifecycleStatus(ctx, lifecycle);
          return;
        }
        lifecycle.markFailed();
        setLifecycleStatus(ctx, lifecycle);
        ctx.ui.notify(
          result.kind === "start-failure"
            ? `STORM process start failed: ${result.error?.message ?? "unknown error"}`
            : `STORM process failed: ${result.error?.message ?? `exit ${result.exitCode ?? "unknown"}`}`,
          "error",
        );
      });

      return runDir;
    },
  });

  pi.registerCommand("storm-cancel", {
    description: COMMAND_DESCRIPTIONS["storm-cancel"],
    handler: async (_args, ctx) => {
      const result = cancelActiveStormRun({ lifecycle, child: activeChild });
      if (!result) {
        ctx.ui.notify("No active STORM run to cancel.", "warning");
        return null;
      }
      activeChild = null;
      setLifecycleStatus(ctx, lifecycle);
      ctx.ui.notify("STORM run cancelled.", "warning");
      return result;
    },
  });

  pi.registerCommand("storm-resume", {
    description: COMMAND_DESCRIPTIONS["storm-resume"],
    handler: async (args, ctx) => {
      setNoActiveRunStatus(ctx);
      const agentConfig = await loadStormConfig();
      const ok = await preflightFor(ctx, agentConfig);
      if (!ok) return null;
      return await runStormResumeCommand(ctx, args);
    },
  });

  pi.registerCommand("storm-status", {
    description: COMMAND_DESCRIPTIONS["storm-status"],
    handler: async (_args, ctx) => {
      setLifecycleStatus(ctx, lifecycle);
      ctx.ui.notify(`STORM status: ${lifecycle.statusText()}`, "info");
      return lifecycle.snapshot();
    },
  });

  for (const commandName of STORM_COMMANDS) {
    if (commandName === "storm-config" || commandName === "storm-start" || commandName === "storm-resume" || commandName === "storm-status" || commandName === "storm-cancel") continue;
    pi.registerCommand(commandName, {
      description: COMMAND_DESCRIPTIONS[commandName],
      handler: async (_args, ctx) => {
        setNoActiveRunStatus(ctx);
        notifyPlaceholder(ctx);
      },
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    setNoActiveRunStatus(ctx);
  });
}
