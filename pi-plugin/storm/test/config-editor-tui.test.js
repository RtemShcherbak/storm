import { buildEditorItems } from "../src/config-editor-items.js";
import { defaultStormConfig } from "../src/config.js";

function check(condition, name) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`✓ ${name}`);
}

function checkFail(name) {
  console.log(`✗ ${name}`);
  throw new Error(`FAILED: ${name}`);
}

// SettingsList.activateItem() only calls onChange(id, value) when an item has
// a non-empty `values` array (or a submenu). Action rows (Save/Cancel/Reset)
// with empty values were silently unreachable — Enter did nothing. Regression:
// every action row must carry a non-empty values array so the real pi-tui
// SettingsList can activate it.
const draft = defaultStormConfig();
const items = buildEditorItems(draft, { env: {} });

const ACTION_IDS = ["__save__", "__cancel__", "__reset__"];
const found = new Set(items.map((i) => i.id));

for (const id of ACTION_IDS) {
  if (!found.has(id)) {
    checkFail(`${id} row present`);
  }
  const row = items.find((i) => i.id === id);
  if (!row.values || row.values.length === 0) {
    checkFail(`${id} has non-empty values (SettingsList requires it to fire onChange)`);
  }
  check(`${id} has non-empty values (SettingsList requires it to fire onChange)`, id);
}

// Section headers must NOT be activatable — they must not accidentally cycle.
const HEADER_IDS = ["__header_models__", "__header_retriever__", "__header_stages__", "__header_runtime__"];
for (const id of HEADER_IDS) {
  const row = items.find((i) => i.id === id);
  if (row.values && row.values.length > 0) {
    checkFail(`${id} header is inert (empty values)`);
  }
  check(`${id} header is inert (empty values)`, id);
}

console.log(`\nAll config-editor-tui item-contract checks passed.`);
