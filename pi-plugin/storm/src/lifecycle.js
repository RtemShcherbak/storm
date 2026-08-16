const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const RUNNING_PHASES = new Set(["research", "outline", "article", "polish", "post_run"]);

function normalizePhase(phase) {
  return RUNNING_PHASES.has(phase) ? phase : "research";
}

function makeSnapshot(state) {
  return Object.freeze({
    status: state.status,
    phase: state.phase,
    runDir: state.runDir,
  });
}

export function createStormRunLifecycle() {
  const state = {
    status: "not_started",
    phase: null,
    runDir: null,
  };

  function snapshot() {
    return makeSnapshot(state);
  }

  function isActive() {
    return state.status === "running";
  }

  function start(runDir, phase = "research") {
    if (isActive()) {
      return {
        errorCode: "active-run",
        message: `A STORM run is already active: ${state.runDir}`,
        snapshot: snapshot(),
      };
    }
    state.runDir = runDir;
    state.status = "running";
    state.phase = normalizePhase(phase);
    return snapshot();
  }

  function setPhase(phase) {
    if (!isActive()) return snapshot();
    state.phase = normalizePhase(phase);
    return snapshot();
  }

  function finish(status) {
    if (!TERMINAL_STATUSES.has(status)) {
      return snapshot();
    }
    state.status = status;
    state.phase = null;
    return snapshot();
  }

  function markCompleted() {
    return finish("completed");
  }

  function markFailed() {
    return finish("failed");
  }

  function markCancelled() {
    return finish("cancelled");
  }

  function clear() {
    state.status = "not_started";
    state.phase = null;
    state.runDir = null;
    return snapshot();
  }

  function statusText() {
    if (state.status === "running" && state.phase) return `running:${state.phase}`;
    return state.status;
  }

  return {
    snapshot,
    isActive,
    start,
    setPhase,
    markCompleted,
    markFailed,
    markCancelled,
    clear,
    statusText,
  };
}
