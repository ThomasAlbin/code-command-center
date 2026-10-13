// @ts-check
import streamDeck from "@elgato/streamdeck";
import os from "node:os";
import path from "node:path";
import { ProjectPageAction } from "./actions/project-page.js";
import { QuotaAction } from "./actions/quota.js";
import { SessionAction } from "./actions/session.js";
import { ClaudeCli } from "./adapters/claude-cli.js";
import { DevContainers } from "./adapters/containers.js";
import { bringToFront } from "./adapters/launcher.js";
import { readLocalLogos } from "./adapters/local-logos.js";
import { isAlive, readProcessTable } from "./adapters/process-table.js";
import { ensureDirectory, readReadings } from "./adapters/usage-files.js";
import { watchDirectory } from "./adapters/watch.js";
import { Board } from "./app/board.js";
import { MonitorSet } from "./app/monitor-set.js";
import { SessionMonitor } from "./app/session-monitor.js";
import { UsageMonitor } from "./app/usage-monitor.js";
import { LOGOS } from "./core/logos.js";

const PLUGIN = "com.thomasalbin.code-command-center";
const home = os.homedir();
const { logger } = streamDeck;

// Sessions on this Mac. Claude Code rewrites `<pid>.json` in its sessions
// folder when a session changes state; that is only a prompt to list sessions
// again, and the files are never read.
const cli = new ClaudeCli(home, readProcessTable);
const mac = new SessionMonitor({
  listSessions: () => cli.listSessions(),
  readProcessTable,
  isAlive,
  watch: (onChange) => watchDirectory(path.join(home, ".claude", "sessions"), /^\d+\.json$/, onChange),
  now: Date.now,
});

// Sessions in Dev Containers. Nothing on the Mac signals a change inside a
// container, so these are asked every few seconds while a VS Code key shows.
const devContainers = new DevContainers(Date.now);
const containers = new SessionMonitor({
  listSessions: () => devContainers.listSessions(),
  readProcessTable: async () => new Map(),
  isAlive: () => true, // their process ids mean nothing on the Mac; each listing is the check
  watch: () => ({ close() {} }),
  now: Date.now,
  classify: () => "vscode",
  poll: { activeMs: 2_500, idleMs: 3_500 },
});

const monitor = new MonitorSet(mac, containers);
// Keys carry the logo of their app where that app is installed here, and the
// plugin's own mark where it is not.
const logos = { ...LOGOS, ...readLocalLogos(home) };
const board = new Board({ monitor, bringToFront, now: Date.now, logos });

// Plan usage, as the `deck-bridge` mod writes it: into a folder on this Mac,
// and inside each Dev Container that has the mod. Without the mod there is
// nothing to read and the quota keys say so.
const usageDirectory = path.join(home, ".code-command-center", "usage");
const usage = new UsageMonitor({
  read: () => readReadings(usageDirectory, Date.now()),
  watch: (onChange) => watchDirectory(usageDirectory, /\.json$/, onChange),
  prepare: () => ensureDirectory(usageDirectory),
  now: Date.now,
  readElsewhere: () => devContainers.readReadings(),
});

// Session names and paths stay out of the log on purpose.
let healthy = true;
let installed = true;
let version = cli.version;
mac.onChange(() => {
  if (mac.healthy !== healthy) {
    healthy = mac.healthy;
    if (healthy) logger.info("Listing Claude Code sessions works again");
    else logger.warn("Listing Claude Code sessions keeps failing; keys show '?' until it recovers");
  }
  if (cli.installed !== installed) {
    installed = cli.installed;
    if (installed) logger.info("Claude Code was found on this Mac");
    else logger.info("No Claude Code found on this Mac; only sessions in Dev Containers can be shown");
  }
  if (cli.version !== version) {
    version = cli.version;
    logger.info(`Using Claude Code ${version} to list sessions`);
  }
});
process.on("unhandledRejection", () => logger.error("An operation failed unexpectedly"));

streamDeck.actions.registerAction(new SessionAction(`${PLUGIN}.session-desktop`, "desktop", board));
streamDeck.actions.registerAction(new SessionAction(`${PLUGIN}.session-vscode`, "vscode", board));
streamDeck.actions.registerAction(new QuotaAction(`${PLUGIN}.quota-5h`, "five_hour", "5h", usage));
streamDeck.actions.registerAction(new QuotaAction(`${PLUGIN}.quota-7d`, "seven_day", "7d", usage));
// The logo key has the Stream Deck app open the project's page; the plugin itself opens nothing.
streamDeck.actions.registerAction(new ProjectPageAction(`${PLUGIN}.project-page`, (url) => streamDeck.system.openUrl(url)));

// Sessions come and go with the apps and nothing is listed during sleep.
streamDeck.system.onApplicationDidLaunch(() => monitor.requestRefresh());
streamDeck.system.onApplicationDidTerminate(() => monitor.requestRefresh());
streamDeck.system.onSystemDidWakeUp(() => {
  monitor.requestRefresh();
  usage.refresh();
  void usage.fetchElsewhere();
});

await streamDeck.connect();
logger.info("Code Command Center connected");
