/**
 * Cancel the single active Managed STORM run.
 *
 * - Stops the active Python process (best effort).
 * - Marks the run `cancelled` (distinct from `failed`).
 * - Keeps the artifact directory and already-written artifacts.
 * - Does not create a new run identity.
 *
 * Returns the updated lifecycle snapshot, or null if there is no active run to
 * cancel.
 */
export function cancelActiveStormRun({ lifecycle, child }) {
  if (!lifecycle || !lifecycle.isActive()) {
    return null;
  }
  try {
    child?.kill?.();
  } catch {
    // Best effort: the process may already be gone.
  }
  return lifecycle.markCancelled();
}
