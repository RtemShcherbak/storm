import { availableStormModelRefs, describeStormModelRef, STORM_LM_ROLES, stormModelRoleLabel } from "./models.js";

function normalizeRegistry(registry) {
  if (!registry || typeof registry !== "object") {
    throw new Error("storm-config requires a model registry");
  }
  if (typeof registry.getAvailable !== "function" || typeof registry.find !== "function") {
    throw new Error("storm-config requires a Pi model registry");
  }
  return registry;
}

export async function promptStormLmModels(ctx, currentModels) {
  const registry = normalizeRegistry(ctx.modelRegistry);
  await registry.refresh?.();
  const availableModels = await registry.getAvailable();
  const availableRefs = availableStormModelRefs(availableModels);
  const nextModels = { ...currentModels };

  for (const role of STORM_LM_ROLES) {
    const currentRef = currentModels[role];
    const currentDescription = describeStormModelRef(registry, availableRefs, currentRef);
    if (currentDescription.state === "missing" || currentDescription.state === "unavailable" || currentDescription.state === "invalid") {
      ctx.ui.notify(
        `STORM ${role}: current model ${currentDescription.ref ?? "unset"} is ${currentDescription.state}`,
        "warning",
      );
    }

    const choices = [
      `keep current${currentRef ? ` (${currentRef})` : " (unset)"}`,
      ...availableRefs,
    ];
    const selected = await ctx.ui.select(`Choose ${stormModelRoleLabel(role)}`, choices);
    if (typeof selected !== "string") continue;
    if (selected.startsWith("keep current")) continue;
    nextModels[role] = selected;
  }

  return nextModels;
}
