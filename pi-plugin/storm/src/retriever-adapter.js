import { getStormRetrieverDef, missingRetrieverCredentials } from "./retrievers.js";

/**
 * Resolved retriever credential-passing mechanism (T13).
 *
 * Credentials are never stored in config. They are read from environment
 * variables in the STORM Python process (inherited via the launch env), using
 * the backend's declared credentialEnv names. The Python launcher builds the
 * `rm` object from the selected backend id + non-secret settings + env creds.
 *
 * A backend whose required credentials are absent blocks launch (no magic
 * fallback).
 */
export function buildRetrieverAdapterSeam(retrieverConfig) {
  const source = retrieverConfig ?? {};
  const backend = getStormRetrieverDef(source.backend) ? source.backend : null;
  const def = backend ? getStormRetrieverDef(backend) : null;
  const settings = { ...(source.settings ?? {}) };
  return {
    backend,
    settings,
    credentialEnv: def ? [...def.credentialEnv] : [],
    missingCredentials(env) {
      if (!def) return [];
      return missingRetrieverCredentials(def, env);
    },
  };
}
