import {
  availableStormModelRefs,
  defaultStormLmModels,
  describeStormModelRef,
  normalizeStormLmModels,
  stormModelRef,
} from "../src/models.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

const defaultModels = defaultStormLmModels();
check("defaults start unset", Object.values(defaultModels).every((value) => value === null));

const normalized = normalizeStormLmModels({
  conv_simulator_lm: " anthropic/claude-sonnet-4-5 ",
  question_asker_lm: "",
});
check("normalize trims model refs", normalized.conv_simulator_lm === "anthropic/claude-sonnet-4-5");
check("normalize drops empty model refs", normalized.question_asker_lm === null);

const models = [
  { provider: "anthropic", id: "claude-sonnet-4-5" },
  { provider: "openai", id: "gpt-5" },
];
check("model refs serialize as provider/id", stormModelRef(models[0]) === "anthropic/claude-sonnet-4-5");
check("available refs are sorted", availableStormModelRefs(models)[0] === "anthropic/claude-sonnet-4-5");

const registry = {
  find(provider, id) {
    return models.find((model) => model.provider === provider && model.id === id);
  },
};
const availableRefs = ["anthropic/claude-sonnet-4-5"];
check("describes available refs", describeStormModelRef(registry, availableRefs, "anthropic/claude-sonnet-4-5").state === "available");
check("describes unavailable refs", describeStormModelRef(registry, availableRefs, "openai/gpt-5").state === "unavailable");
check("describes missing refs", describeStormModelRef(registry, availableRefs, "openai/missing").state === "missing");
check("describes invalid refs", describeStormModelRef(registry, availableRefs, "bad-ref").state === "invalid");
