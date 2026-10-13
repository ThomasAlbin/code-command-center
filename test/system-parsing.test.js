// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { openClaudeSession } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/exec.js";
import { CLAUDE_DESKTOP, focusTarget, VS_CODE } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/focus.js";
import { classifyClient, parsePs } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-ps.js";
import { compareVersions, parseVersion } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/version.js";

// Shaped like `ps -axo pid=,ppid=,comm=` on macOS, with made-up paths.
const PS = `
    1     0 /sbin/launchd
  500     1 /Applications/Claude.app/Contents/MacOS/Claude
  510   500 /Applications/Claude.app/Contents/Helpers/disclaimer
  511   510 /Users/dev/Library/Application Support/Claude/claude-code/2.1.293/abc/claude.app/Contents/MacOS/claude
  600     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  610   600 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)
  611   610 /Users/dev/.vscode/extensions/anthropic.claude-code-2.1.292-darwin-arm64/resources/native-binary/claude
  700     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal
  710   700 -zsh
  711   710 /Users/dev/.local/bin/claude
`;

test("reads pid, parent and executable, including paths with spaces", () => {
  const table = parsePs(PS);
  assert.equal(table.size, 10);
  assert.deepEqual(table.get(510), { ppid: 500, comm: "/Applications/Claude.app/Contents/Helpers/disclaimer" });
  assert.ok(table.get(610)?.comm.endsWith("Code Helper (Plugin)"));
});

test("a session is attributed to the app that started it", () => {
  const table = parsePs(PS);
  assert.equal(classifyClient(511, table), "desktop");
  assert.equal(classifyClient(611, table), "vscode");
  assert.equal(classifyClient(711, table), "other");
});

test("an unknown pid belongs to no app", () => {
  assert.equal(classifyClient(999, parsePs(PS)), "other");
  assert.equal(classifyClient(511, new Map()), "other");
});

test("a broken parent chain does not loop forever", () => {
  const table = parsePs("  20  21 a\n  21  20 b\n");
  assert.equal(classifyClient(20, table), "other");
});

test("a desktop session brings the Claude app forward", () => {
  assert.deepEqual(focusTarget("desktop", { cwd: "/Users/dev/projects/alpha" }), { bundleId: CLAUDE_DESKTOP });
  assert.deepEqual(focusTarget("desktop"), { bundleId: CLAUDE_DESKTOP });
});

const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
const LIVE = { pid: 4242, kind: "interactive", sessionId: SESSION, cwd: "/Users/dev/projects/alpha" };

test("a desktop key names its session, so the Claude app shows that one", () => {
  assert.deepEqual(focusTarget("desktop", LIVE), { bundleId: CLAUDE_DESKTOP, session: SESSION });
});

test("a session the Claude app might not run is never named to it", () => {
  assert.deepEqual(focusTarget("desktop", { ...LIVE, pid: undefined }), { bundleId: CLAUDE_DESKTOP }, "no running process");
  assert.deepEqual(focusTarget("desktop", { ...LIVE, kind: "background" }), { bundleId: CLAUDE_DESKTOP });
  assert.deepEqual(focusTarget("desktop", { ...LIVE, sessionId: "last" }), { bundleId: CLAUDE_DESKTOP }, "not an id");
  assert.deepEqual(focusTarget("desktop", { ...LIVE, sessionId: `${SESSION}&q=hello` }), { bundleId: CLAUDE_DESKTOP });
  assert.equal(focusTarget("vscode", LIVE)?.session, undefined, "VS Code's sessions are not the Claude app's");
});

test("only a session id can be put into a link to the Claude app", async () => {
  // Refused before any program is started.
  for (const bad of ["", "last", `${SESSION}&q=hello`, `${SESSION}/../x`, "claude://code/new?q=hi"]) {
    await assert.rejects(openClaudeSession(bad), /not a session id/);
  }
});

test("a VS Code session brings its folder's window forward", () => {
  assert.deepEqual(focusTarget("vscode", { cwd: "/Users/dev/projects/alpha" }), {
    bundleId: VS_CODE,
    folder: "/Users/dev/projects/alpha",
  });
  assert.deepEqual(focusTarget("vscode"), { bundleId: VS_CODE });
  assert.deepEqual(focusTarget("vscode", { cwd: "relative/path" }), { bundleId: VS_CODE });
});

test("a session in a Dev Container brings the container's window forward", () => {
  const container = { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" };
  assert.deepEqual(focusTarget("vscode", { cwd: "/workspaces/app", container }), {
    bundleId: VS_CODE,
    devContainer: { localFolder: "/Users/dev/projects/app", path: "/workspaces/app" },
  });
});

test("a reserved VS Code key without a session opens its project", () => {
  assert.deepEqual(focusTarget("vscode", undefined, "/Users/dev/projects/app"), {
    bundleId: VS_CODE,
    folder: "/Users/dev/projects/app",
    devContainer: { localFolder: "/Users/dev/projects/app" },
  });
});

test("sessions from other places have nothing to focus", () => {
  assert.equal(focusTarget("other", { cwd: "/tmp" }), undefined);
});

test("versions compare by number, not by text", () => {
  const newer = parseVersion("2.1.293");
  const older = parseVersion("2.1.99");
  assert.ok(newer && older);
  assert.ok(compareVersions(newer, older) > 0);
  assert.equal(compareVersions(newer, newer), 0);
  assert.equal(parseVersion("latest"), undefined);
  assert.equal(parseVersion("2.1"), undefined);
});

test("the Claude Code that sessions already run is asked first", async () => {
  const { preferRunning } = await import("../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/claude-cli.js");
  const binaries = [
    { file: "/ext/2.1.294/claude", version: [2, 1, 294] },
    { file: "/desktop/2.1.293/claude", version: [2, 1, 293] },
    { file: "/desktop/2.1.289/claude", version: [2, 1, 289] },
  ];
  const ordered = preferRunning(binaries, new Set(["/desktop/2.1.293/claude", "/usr/bin/other"]));
  assert.deepEqual(ordered.map((binary) => binary.file), ["/desktop/2.1.293/claude", "/ext/2.1.294/claude", "/desktop/2.1.289/claude"]);
  assert.deepEqual(preferRunning(binaries, new Set()), binaries, "with nothing running the newest stays first");
});
