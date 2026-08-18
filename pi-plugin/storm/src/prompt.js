export function normalizeCommandContext(ctx) {
  if (!ctx || !ctx.ui) {
    throw new Error("storm-config requires a UI-capable Pi context");
  }
  return ctx;
}
