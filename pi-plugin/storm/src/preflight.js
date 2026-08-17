import { spawnSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { STORM_LM_ROLES, describeStormModelRef } from "./models.js";
import {
  getStormRetrieverDef,
  missingRetrieverCredentials,
  missingRetrieverSettings,
} from "./retrievers.js";

function makeProblem(code, message, detail = undefined) {
  return { code, message, ...(detail !== undefined ? { detail } : {}) };
}

async function listAvailableModelRefs(modelRegistry) {
  if (!modelRegistry || typeof modelRegistry.getAvailable !== "function") return [];
  try {
    const models = await modelRegistry.getAvailable();
    return (models ?? []).map((m) => `${m.provider}/${m.id}`);
  } catch {
    return [];
  }
}

export function defaultStormPreflightProbes({ workspaceRoot } = {}) {
  return {
    pythonAvailable: async (pythonCommand) => {
      if (!pythonCommand) return false;
      try {
        const result = spawnSync(pythonCommand, ["--version"], { timeout: 10000 });
        return result.error === undefined && result.status === 0;
      } catch {
        return false;
      }
    },
    stormImportable: async (pythonCommand) => {
      if (!pythonCommand) return false;
      try {
        const result = spawnSync(pythonCommand, ["-c", "import knowledge_storm"], {
          cwd: workspaceRoot,
          env: {
            ...process.env,
            PYTHONPATH: [workspaceRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
          },
          timeout: 20000,
        });
        return result.error === undefined && result.status === 0;
      } catch {
        return false;
      }
    },
    outputWritable: async (outputRoot) => {
      if (!outputRoot) return false;
      let probePath = null;
      try {
        await mkdir(resolve(outputRoot), { recursive: true });
        probePath = join(resolve(outputRoot), `.storm-write-probe-${randomBytes(4).toString("hex")}`);
        await writeFile(probePath, "probe", "utf8");
        await unlink(probePath);
        return true;
      } catch {
        if (probePath) {
          try {
            await unlink(probePath);
          } catch {
            // best effort cleanup
          }
        }
        return false;
      }
    },
  };
}

let probesOverride = null;

export function setStormPreflightProbesForTesting(probes) {
  probesOverride = probes ?? null;
}

function resolveProbes(probes, workspaceRoot) {
  if (probes) return probes;
  if (probesOverride) return probesOverride;
  return defaultStormPreflightProbes({ workspaceRoot });
}

export async function runStormPreflight({ config, modelRegistry, env = process.env, probes, workspaceRoot }) {
  const problems = [];
  const activeProbes = resolveProbes(probes, workspaceRoot);

  const availableRefs = await listAvailableModelRefs(modelRegistry);

  // LM model selections.
  for (const role of STORM_LM_ROLES) {
    const ref = config.lmModels?.[role];
    if (!ref) {
      problems.push(makeProblem("missing-lm", `No model selected for ${role}`, role));
      continue;
    }
    const described = describeStormModelRef(modelRegistry, availableRefs, ref);
    if (described.state !== "available") {
      problems.push(
        makeProblem("lm-unavailable", `Model ${ref} for ${role} is ${described.state}`, role),
      );
    }
  }

  // Retriever backend + credential/param state.
  const retrieverBackend = config.retriever?.backend;
  if (!retrieverBackend) {
    problems.push(makeProblem("missing-retriever", "No retriever backend selected"));
  } else {
    const def = getStormRetrieverDef(retrieverBackend);
    if (!def) {
      problems.push(makeProblem("invalid-retriever", `Unknown retriever backend ${retrieverBackend}`, retrieverBackend));
    } else {
      const missingParams = missingRetrieverSettings(def, config.retriever?.settings ?? {});
      for (const param of missingParams) {
        problems.push(
          makeProblem("missing-retriever-setting", `Retriever ${retrieverBackend} missing setting ${param}`, param),
        );
      }
      const missingCreds = missingRetrieverCredentials(def, env);
      for (const credential of missingCreds) {
        problems.push(
          makeProblem("missing-retriever-credential", `Retriever ${retrieverBackend} missing credential ${credential}`, credential),
        );
      }
    }
  }

  // Python / STORM availability.
  const pythonOk = await activeProbes.pythonAvailable(config.runtime?.python);
  if (!pythonOk) {
    problems.push(makeProblem("python-unavailable", `Python command '${config.runtime?.python ?? "(none)"}' is not available`));
  }
  const stormOk = await activeProbes.stormImportable(config.runtime?.python);
  if (!stormOk) {
    problems.push(makeProblem("storm-unavailable", "STORM (knowledge_storm) is not importable"));
  }

  // Output directory writability.
  const outputWritable = await activeProbes.outputWritable(config.runtime?.outputRoot);
  if (!outputWritable) {
    problems.push(makeProblem("output-not-writable", `Output root '${config.runtime?.outputRoot ?? "(none)"}' is not writable`));
  }

  return problems;
}
