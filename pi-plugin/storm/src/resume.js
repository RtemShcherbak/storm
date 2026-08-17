/**
 * Given an artifact snapshot (T05) and the configured stage flags, compute the
 * stage flags for a resume run: only stages that are BOTH selected AND not yet
 * complete are run. Completed stages are never rerun by default; unselected
 * stages are never run.
 */
export function computeResumeStageFlags(snapshot, stageFlags) {
  const stages = snapshot?.stages ?? {};
  const flags = stageFlags ?? {};
  return {
    doResearch: (flags.doResearch ?? true) && !stages.research?.complete,
    doGenerateOutline: (flags.doGenerateOutline ?? true) && !stages.outline?.complete,
    doGenerateArticle: (flags.doGenerateArticle ?? true) && !stages.article?.complete,
    doPolishArticle: (flags.doPolishArticle ?? true) && !stages.polish?.complete,
  };
}
