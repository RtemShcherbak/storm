import { defaultStormConfig } from "../src/config.js";
import { runStormPreflight, setStormPreflightProbesForTesting } from "../src/preflight.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

function passingProbes() {
  return {
    pythonAvailable: async () => true,
    stormImportable: async () => true,
    outputWritable: async () => true,
  };
}

class FakeModelRegistry {
  constructor(availableRefs = []) {
    this.models = availableRefs.map((ref) => {
      const [provider, ...rest] = ref.split("/");
      return { provider, id: rest.join("/") };
    });
  }
  async getAvailable() {
    return this.models;
  }
  find(provider, id) {
    return this.models.find((m) => m.provider === provider && m.id === id);
  }
}

const availableRefs = ["anthropic/claude-sonnet-4-5", "openai/gpt-5"];

function completeConfig(overrides = {}) {
  const cfg = defaultStormConfig();
  cfg.lmModels.conv_simulator_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.question_asker_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.outline_gen_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.article_gen_lm = "anthropic/claude-sonnet-4-5";
  cfg.lmModels.article_polish_lm = "anthropic/claude-sonnet-4-5";
  cfg.retriever.backend = "you";
  cfg.retriever.settings = {};
  cfg.runtime.python = "python3";
  cfg.runtime.outputRoot = "/tmp/out";
  return { ...cfg, ...overrides };
}

// 1. Fully valid config passes with no problems.
{
  const problems = await runStormPreflight({
    config: completeConfig(),
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: passingProbes(),
  });
  check("valid config produces no problems", problems.length === 0);
}

// 2. Unset LM roles are reported.
{
  const cfg = completeConfig();
  cfg.lmModels.conv_simulator_lm = null;
  cfg.lmModels.article_gen_lm = null;
  const problems = await runStormPreflight({
    config: cfg,
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: passingProbes(),
  });
  check("missing LM roles are reported", problems.some((p) => p.code === "missing-lm"));
}

// 3. Unavailable LM model is reported (no fallback).
{
  const cfg = completeConfig();
  cfg.lmModels.conv_simulator_lm = "anthropic/nonexistent-model";
  const problems = await runStormPreflight({
    config: cfg,
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: passingProbes(),
  });
  check("unavailable LM model is reported without fallback", problems.some((p) => p.code === "lm-unavailable"));
  check("no fallback model is selected", cfg.lmModels.conv_simulator_lm === "anthropic/nonexistent-model");
}

// 4. Missing retriever backend reported.
{
  const cfg = completeConfig();
  cfg.retriever.backend = null;
  const problems = await runStormPreflight({
    config: cfg,
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: passingProbes(),
  });
  check("missing retriever backend is reported", problems.some((p) => p.code === "missing-retriever"));
}

// 5. Missing retriever credential reported.
{
  const problems = await runStormPreflight({
    config: completeConfig(),
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: {},
    probes: passingProbes(),
  });
  check("missing retriever credential is reported", problems.some((p) => p.code === "missing-retriever-credential"));
}

// 6. Python / STORM availability failures reported.
{
  const problems = await runStormPreflight({
    config: completeConfig(),
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: {
      pythonAvailable: async () => false,
      stormImportable: async () => true,
      outputWritable: async () => true,
    },
  });
  check("unavailable python is reported", problems.some((p) => p.code === "python-unavailable"));
}

// 7. Output not writable reported.
{
  const problems = await runStormPreflight({
    config: completeConfig(),
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: {
      pythonAvailable: async () => true,
      stormImportable: async () => true,
      outputWritable: async () => false,
    },
  });
  check("unwritable output is reported", problems.some((p) => p.code === "output-not-writable"));
}

// 8b. The testing-hook probe path is honored when no probes are passed
// (verifies the real command path resolves active probes).
try {
  setStormPreflightProbesForTesting({
    pythonAvailable: async () => false,
    stormImportable: async () => false,
    outputWritable: async () => false,
  });
  const problems = await runStormPreflight({
    config: completeConfig(),
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
  });
  check("probe failures block via resolved default probes", problems.some((p) => p.code === "python-unavailable"));
  check("storm probe failure reported", problems.some((p) => p.code === "storm-unavailable"));
  check("output probe failure reported", problems.some((p) => p.code === "output-not-writable"));
} finally {
  setStormPreflightProbesForTesting(null);
}

// 8a. Adapter incompatibility (missing role) is surfaced as launch-blocking.
{
  const cfg = completeConfig();
  cfg.lmModels.conv_simulator_lm = null;
  const problems = await runStormPreflight({
    config: cfg,
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: { YDC_API_KEY: "x" },
    probes: passingProbes(),
  });
  check("adapter missing role is surfaced", problems.some((p) => p.code === "lm-incompatible"));
}

// 8. Multiple missing requirements reported together.
{
  const cfg = completeConfig();
  cfg.lmModels.conv_simulator_lm = null;
  cfg.lmModels.question_asker_lm = null;
  cfg.retriever.backend = null;
  const problems = await runStormPreflight({
    config: cfg,
    modelRegistry: new FakeModelRegistry(availableRefs),
    env: {},
    probes: passingProbes(),
  });
  check("multiple missing requirements are reported together", problems.length >= 3);
}
