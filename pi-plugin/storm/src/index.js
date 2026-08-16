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
  "storm-config": "Configure STORM settings (placeholder).",
  "storm-start": "Start a new Managed STORM run (placeholder).",
  "storm-resume": "Resume an existing Managed STORM run (placeholder).",
  "storm-cancel": "Cancel the active Managed STORM run (placeholder).",
  "storm-status": "Show Managed STORM run status (placeholder).",
  "storm-artifacts": "View Managed STORM run artifacts (placeholder).",
});

function setNoActiveRunStatus(ctx) {
  ctx.ui.setStatus(STORM_STATUS_KEY, NO_ACTIVE_RUN_STATUS);
}

function notifyPlaceholder(ctx) {
  ctx.ui.notify(PLACEHOLDER_MESSAGE, "info");
}

export default function stormExtension(pi) {
  for (const commandName of STORM_COMMANDS) {
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
