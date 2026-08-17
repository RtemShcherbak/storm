/**
 * Build the artifact view for a run from its artifact snapshot (T05).
 *
 * Surfaces the Stage-dependent primary result and the canonical artifact list.
 * Missing artifacts for nonselected stages are not treated as errors.
 */
export function buildArtifactView(snapshot) {
  return {
    runDir: snapshot?.runDir ?? null,
    primaryResult: snapshot?.primaryResult ?? null,
    canonicalArtifacts: (snapshot?.canonicalArtifacts ?? []).map((artifact) => ({
      name: artifact.name,
      path: artifact.path,
    })),
    errors: [],
  };
}
