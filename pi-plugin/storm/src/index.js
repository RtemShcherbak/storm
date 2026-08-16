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
  "storm-cancel": "Cancel the active Managed STORM run (placeholder).",
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
  const { runStormConfigCommand } = await import("./storm-config.js");
  const { runStormResumeCommand, runStormStartCommand } = await import("./runs.js");
  const lifecycle = createStormRunLifecycle();

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
      const runDir = await runStormStartCommand(ctx, args);
      lifecycle.start(runDir, "research");
      setLifecycleStatus(ctx, lifecycle);
      return runDir;
    },
  });

  pi.registerCommand("storm-resume", {
    description: COMMAND_DESCRIPTIONS["storm-resume"],
    handler: async (args, ctx) => {
      setNoActiveRunStatus(ctx);
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
    if (commandName === "storm-config" || commandName === "storm-start" || commandName === "storm-resume" || commandName === "storm-status") continue;
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
