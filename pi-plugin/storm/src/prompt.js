export function normalizeCommandContext(ctx) {
  if (!ctx || !ctx.ui) {
    throw new Error("storm-config requires a UI-capable Pi context");
  }
  return ctx;
}

export async function promptText(ctx, label, current) {
  const answer = await ctx.ui.input(label, current);
  if (typeof answer !== "string") return current;
  const trimmed = answer.trim();
  return trimmed ? trimmed : current;
}

export async function promptToggle(ctx, label, current) {
  const answer = await ctx.ui.input(label, current ? "on" : "off");
  if (typeof answer !== "string") return current;
  const normalized = answer.trim().toLowerCase();
  if (normalized === "on" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "off" || normalized === "false" || normalized === "no") return false;
  return current;
}

export async function promptNumber(ctx, label, current) {
  const answer = await ctx.ui.input(label, String(current));
  if (typeof answer !== "string") return current;
  const parsed = Number.parseInt(answer.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : current;
}
