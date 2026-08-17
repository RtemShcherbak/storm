import stormExtension, {
  NO_ACTIVE_RUN_STATUS,
  STORM_COMMANDS,
  STORM_STATUS_KEY,
} from "../src/index.js";

class FakeUi {
  statuses = new Map();
  notifications = [];

  setStatus(key, value) {
    this.statuses.set(key, value);
  }

  notify(message, level) {
    this.notifications.push({ message, level });
  }
}

class FakeCommandContext {
  ui = new FakeUi();
}

class FakePi {
  commands = new Map();
  handlers = new Map();

  registerCommand(name, command) {
    this.commands.set(name, command);
  }

  on(eventName, handler) {
    const current = this.handlers.get(eventName) ?? [];
    current.push(handler);
    this.handlers.set(eventName, current);
  }
}

function check(name, condition) {
  if (!condition) {
    throw new Error(`FAILED: ${name}`);
  }
  console.log(`✓ ${name}`);
}

function hasNotification(ctx, fragment) {
  return ctx.ui.notifications.some((notification) => notification.message.includes(fragment));
}

const pi = new FakePi();
await stormExtension(pi);

for (const commandName of STORM_COMMANDS) {
  check(`registers /${commandName}`, pi.commands.has(commandName));
}

const sessionStartHandlers = pi.handlers.get("session_start") ?? [];
check("registers session_start handler", sessionStartHandlers.length === 1);
const sessionCtx = new FakeCommandContext();
await sessionStartHandlers[0]?.({}, sessionCtx);
check(
  "sets no-active-run footer status on session start",
  sessionCtx.ui.statuses.get(STORM_STATUS_KEY) === NO_ACTIVE_RUN_STATUS,
);

for (const commandName of ["storm-artifacts"]) {
  const ctx = new FakeCommandContext();
  await pi.commands.get(commandName)?.handler("", ctx);
  check(`/${commandName} reports placeholder availability`, hasNotification(ctx, "not available yet"));
}

check("does not register extra commands", pi.commands.size === STORM_COMMANDS.length);
