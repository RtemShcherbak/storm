export const STORM_STATUS_KEY = "storm";
export const NO_ACTIVE_RUN_STATUS = "○ STORM: no active run";

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
  "storm-artifacts": "View a run's primary result and canonical artifacts.",
});

function setNoActiveRunStatus(ctx) {
  ctx.ui.setStatus(STORM_STATUS_KEY, NO_ACTIVE_RUN_STATUS);
}

function setLifecycleStatus(ctx, lifecycle) {
  const status = lifecycle.statusText();
  ctx.ui.setStatus(STORM_STATUS_KEY, status === "not_started" ? NO_ACTIVE_RUN_STATUS : `○ STORM: ${status}`);
}

export default async function stormExtension(pi) {
  const { createStormRunLifecycle } = await import("./lifecycle.js");
  const { loadStormConfig } = await import("./config.js");
  const { launchManagedStormProcess, getStormWorkspaceRoot } = await import("./process.js");
  const { runStormPreflight } = await import("./preflight.js");
  const { inspectStormArtifacts } = await import("./artifacts.js");
  const { cancelActiveStormRun } = await import("./cancel.js");
  const { buildArtifactView } = await import("./artifact-view.js");
  const { classifyProcessOutcome, buildErrorReport, formatErrorReport } = await import("./error-reporting.js");
  const { loadStormRunPointer } = await import("./runs.js");
  const { computeResumeStageFlags } = await import("./resume.js");
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
      const report = buildErrorReport(problems);
      ctx.ui.notify(formatErrorReport(report), "error");
      return false;
    }
    return true;
  }

  function notifyProcessOutcome(ctx, result) {
    const category = classifyProcessOutcome(result);
    const message =
      result.error?.message ??
      (result.exitCode != null ? `process exited with code ${result.exitCode}` : "process failed");
    const report = buildErrorReport([], {
      category,
      message,
      diagnostics: result.diagnostics ?? {},
      error: result.error ?? null,
    });
    ctx.ui.notify(formatErrorReport(report), "error");
  }

  pi.registerCommand("storm-config", {
    description: COMMAND_DESCRIPTIONS["storm-config"],
    handler: async (_args, ctx) => {
      setNoActiveRunStatus(ctx);
      return runStormConfigCommand(ctx);
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
            const report = buildErrorReport([], {
              category: "artifact-post-run",
              message: "post-run artifacts missing after successful process exit",
              diagnostics: result.diagnostics ?? {},
            });
            ctx.ui.notify(formatErrorReport(report), "error");
          }
          setLifecycleStatus(ctx, lifecycle);
          return;
        }
        lifecycle.markFailed();
        setLifecycleStatus(ctx, lifecycle);
        notifyProcessOutcome(ctx, result);
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
      if (lifecycle.isActive()) {
        ctx.ui.notify(`Cannot resume while another STORM run is active: ${lifecycle.snapshot().runDir}`, "error");
        return null;
      }
      const agentConfig = await loadStormConfig();
      const ok = await preflightFor(ctx, agentConfig);
      if (!ok) return null;
      const runDir = await runStormResumeCommand(ctx, args);
      if (!runDir) return null;

      const snapshot = await inspectStormArtifacts(runDir, {
        selectedStages: agentConfig.stageFlags,
      });
      const resumeFlags = computeResumeStageFlags(snapshot, agentConfig.stageFlags);
      const resumeConfig = {
        ...agentConfig,
        stageFlags: resumeFlags,
      };

      lifecycle.start(runDir, "research");
      setLifecycleStatus(ctx, lifecycle);
      const handle = launchManagedStormProcess({
        config: resumeConfig,
        runDir,
        request: { topic: null },
        workspaceRoot: getStormWorkspaceRoot(),
      });
      activeChild = handle.child ?? null;

      void handle.outcome.then(async (result) => {
        if (lifecycle.snapshot().status === "cancelled") return;
        if (result.kind === "success") {
          lifecycle.setPhase("post_run");
          setLifecycleStatus(ctx, lifecycle);
          const postSnapshot = await inspectStormArtifacts(runDir);
          if (postSnapshot.stages.postRun.complete) {
            lifecycle.markCompleted();
          } else {
            lifecycle.markFailed();
            const report = buildErrorReport([], {
              category: "artifact-post-run",
              message: "post-run artifacts missing after successful process exit",
              diagnostics: result.diagnostics ?? {},
            });
            ctx.ui.notify(formatErrorReport(report), "error");
          }
          setLifecycleStatus(ctx, lifecycle);
          return;
        }
        lifecycle.markFailed();
        setLifecycleStatus(ctx, lifecycle);
        notifyProcessOutcome(ctx, result);
      });

      return runDir;
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

  pi.registerCommand("storm-artifacts", {
    description: COMMAND_DESCRIPTIONS["storm-artifacts"],
    handler: async (args, ctx) => {
      let runDir = typeof args === "string" && args.trim() ? args.trim() : null;
      if (!runDir) {
        const pointer = await loadStormRunPointer();
        runDir = pointer.currentRunDir;
      }
      if (!runDir) {
        ctx.ui.notify("No run directory to inspect. Start or resume a run first.", "warning");
        return null;
      }
      // Artifact viewing reflects all completed artifacts regardless of current
      // config stage selection, so adopted and differently-configured runs report
      // their true stage-dependent primary result.
      const snapshot = await inspectStormArtifacts(runDir);
      const view = buildArtifactView(snapshot);
      ctx.ui.notify(
        `STORM primary result (${view.primaryResult?.label ?? "none"}): ${view.primaryResult?.path ?? "not available"}`,
        "info",
      );
      const artifactNames = view.canonicalArtifacts.map((artifact) => artifact.name);
      ctx.ui.notify(
        artifactNames.length > 0
          ? `STORM canonical artifacts (${artifactNames.length}): ${artifactNames.join(", ")}`
          : "No canonical artifacts found in run directory.",
        "info",
      );
      return view;
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    setNoActiveRunStatus(ctx);
  });
}
