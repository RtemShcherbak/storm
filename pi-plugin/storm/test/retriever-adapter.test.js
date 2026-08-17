import { buildRetrieverAdapterSeam } from "../src/retriever-adapter.js";
import { buildStormLaunchEnv, buildStormLauncherScript } from "../src/launcher.js";
import { defaultStormConfig } from "../src/config.js";

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

// 1. Selected backend maps to a retriever constructor with non-secret settings.
{
  const seam = buildRetrieverAdapterSeam({ backend: "you", settings: {} });
  check("you backend maps to YouRM", seam.backend === "you");
  check("you credential env surfaced", seam.credentialEnv.includes("YDC_API_KEY"));
}

// 2. Non-secret settings are carried.
{
  const seam = buildRetrieverAdapterSeam({
    backend: "searxng",
    settings: { apiUrl: "https://searxng.example.com" },
  });
  check("searxng non-secret setting carried", seam.settings.apiUrl === "https://searxng.example.com");
}

// 3. Missing credential absence is reported (no silent fallback).
{
  const seam = buildRetrieverAdapterSeam({ backend: "you", settings: {} });
  const missing = seam.missingCredentials({});
  check("you missing credential reported", missing.includes("YDC_API_KEY"));
  check("you ready when credential present", seam.missingCredentials({ YDC_API_KEY: "x" }).length === 0);
  check("duckduckgo needs no credential", buildRetrieverAdapterSeam({ backend: "duckduckgo", settings: {} }).missingCredentials({}).length === 0);
}

// 4. Launcher script builds rm from the resolved adapter seam.
{
  const cfg = defaultStormConfig();
  cfg.retriever = { backend: "you", settings: {} };
  const script = buildStormLauncherScript(cfg, { runDir: "/tmp/out/t", request: { topic: "Topic" } });
  check("script imports retriever adapter", /build_rm\(/.test(script));
  check("script wires selected backend", script.includes("YouRM") || script.includes("build_rm"));
}

// 5. Env carries retriever config (backend + non-secret settings), not secrets.
{
  const cfg = defaultStormConfig();
  cfg.retriever = { backend: "searxng", settings: { apiUrl: "https://searxng.example.com" } };
  const env = buildStormLaunchEnv(cfg, { request: { topic: "Topic" } });
  const payload = JSON.parse(env.STORM_LAUNCH_CONFIG);
  check("env carries backend", payload.retriever.backend === "searxng");
  check("env carries non-secret settings", payload.retriever.settings.apiUrl === "https://searxng.example.com");
  check("env does not carry secrets", !JSON.stringify(payload).includes("API_KEY"));
}
