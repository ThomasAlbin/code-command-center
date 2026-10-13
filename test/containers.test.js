// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { dockerClaudeAgentsJson, dockerReadUsage } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/exec.js";
import { projectOf, sessionKey } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-agents.js";
import {
  findClaudeBinary,
  isClaudeInContainer,
  isContainerId,
  isContainerUser,
  parseDevContainers,
  userOf,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-docker.js";
import {
  findDevContainerWindow,
  isDevContainerAddress,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/vscode-windows.js";

const CLAUDE = "/root/.vscode-server/extensions/anthropic.claude-code-2.1.289-linux-arm64/resources/native-binary/claude";

// Shaped like `docker top <id> -eo pid,args`, with made-up values.
const TOP = `PID                 COMMAND
7001                /bin/sh -c echo Container started
7120                /root/.vscode-server/bin/abc123/node /root/.vscode-server/bin/abc123/out/server-main.js --host=127.0.0.1
7758                ${CLAUDE} --output-format stream-json --verbose --input-format stream-json
7790                /usr/bin/python3 /workspaces/app/main.py
`;

/** @param {object} data */
const hex = (data) => Buffer.from(JSON.stringify(data), "utf8").toString("hex");

/**
 * @param {string} hostPath
 * @param {string} containerPath
 */
const address = (hostPath, containerPath) =>
  `vscode-remote://dev-container%2B${hex({ hostPath, localDocker: false, configFile: { path: `${hostPath}/.devcontainer/devcontainer.json` } })}${containerPath}`;

test("reads the running Dev Containers and their folders on the Mac", () => {
  const stdout = "a1b2c3d4e5f6\t/Users/dev/projects/app\n0123456789ab\t/Users/dev/projects/with space\n";
  assert.deepEqual(parseDevContainers(stdout), [
    { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" },
    { id: "0123456789ab", localFolder: "/Users/dev/projects/with space" },
  ]);
});

test("ignores lines that are not a container and a folder", () => {
  assert.deepEqual(parseDevContainers("\nnot-an-id\t/x\na1b2c3d4e5f6\trelative\na1b2c3d4e5f6\n"), []);
  assert.equal(isContainerId("a1b2c3d4e5f6"), true);
  assert.equal(isContainerId("a1b2c3d4e5f6; rm -rf /"), false);
});

test("finds Claude Code among a container's processes", () => {
  assert.equal(findClaudeBinary(TOP), CLAUDE);
  assert.equal(findClaudeBinary("PID COMMAND\n1 /bin/sh\n"), undefined);
});

test("only Claude Code as VS Code installs it counts", () => {
  assert.equal(isClaudeInContainer(CLAUDE), true);
  assert.equal(isClaudeInContainer(CLAUDE.replace("/root/", "/home/vscode/")), true);
  assert.equal(isClaudeInContainer("/tmp/claude"), false);
  assert.equal(isClaudeInContainer("/usr/local/bin/claude"), false);
  assert.equal(isClaudeInContainer(CLAUDE.replace("/root/", "/root/../tmp/")), false);
  assert.equal(isClaudeInContainer(`${CLAUDE} --flag`), false);
  assert.equal(isClaudeInContainer(CLAUDE.replace("native-binary/claude", "native-binary/sh")), false);
});

test("a session in a container is not confused with a process on the Mac", () => {
  const container = { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" };
  const inside = { pid: 886, startedAt: 5, cwd: "/workspaces/app", container };
  assert.notEqual(sessionKey(inside), sessionKey({ pid: 886, startedAt: 5 }));
  assert.notEqual(sessionKey(inside), sessionKey({ ...inside, container: { ...container, id: "0123456789ab" } }));
});

test("a session's project is its folder on the Mac", () => {
  assert.equal(projectOf({ cwd: "/Users/dev/projects/alpha" }), "/Users/dev/projects/alpha");
  assert.equal(
    projectOf({ cwd: "/workspaces/app", container: { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" } }),
    "/Users/dev/projects/app",
  );
});

test("finds the window address VS Code recorded for a Dev Container", () => {
  const app = address("/Users/dev/projects/app", "/workspaces/app");
  const other = address("/Users/dev/projects/other", "/workspaces/other");
  const storage = JSON.stringify({ windowsState: { lastActiveWindow: { folder: other }, openedWindows: [{ folder: app }] } });
  assert.equal(findDevContainerWindow(storage, "/Users/dev/projects/app", "/workspaces/app"), app);
  assert.equal(findDevContainerWindow(storage, "/Users/dev/projects/missing"), undefined);
});

test("prefers the window on the same folder inside the container", () => {
  const root = address("/Users/dev/projects/app", "/workspaces/app");
  const nested = address("/Users/dev/projects/app", "/workspaces/app/service");
  const storage = JSON.stringify({ a: root, b: nested });
  assert.equal(findDevContainerWindow(storage, "/Users/dev/projects/app", "/workspaces/app/service"), nested);
  assert.equal(findDevContainerWindow(storage, "/Users/dev/projects/app", "/workspaces/elsewhere"), root);
  assert.equal(findDevContainerWindow(storage, "/Users/dev/projects/app"), root);
});

test("understands the older address form that encodes the folder itself", () => {
  const legacy = `vscode-remote://dev-container+${Buffer.from("/Users/dev/projects/app").toString("hex")}/workspaces/app`;
  assert.equal(findDevContainerWindow(`{"folder":"${legacy}"}`, "/Users/dev/projects/app"), legacy);
});

test("survives a state file that is not what it expects", () => {
  assert.equal(findDevContainerWindow("", "/x"), undefined);
  assert.equal(findDevContainerWindow("not json at all", "/x"), undefined);
  assert.equal(findDevContainerWindow('{"folder":"vscode-remote://dev-container%2Bzz/ws"}', "/x"), undefined);
});

test("only a Dev Container address is handed to VS Code", () => {
  assert.equal(isDevContainerAddress(address("/Users/dev/projects/app", "/workspaces/app")), true);
  assert.equal(isDevContainerAddress("vscode-remote://ssh-remote+host/home/dev"), false);
  assert.equal(isDevContainerAddress("file:///etc/passwd"), false);
  assert.equal(isDevContainerAddress(`${address("/a", "/b")} --extra`), false);
  assert.equal(isDevContainerAddress(`--install-extension x`), false);
});

test("the user of a container's Claude Code is read off the home folder it is in", () => {
  assert.equal(userOf(CLAUDE), "root");
  assert.equal(userOf(CLAUDE.replace("/root/", "/home/vscode/")), "vscode");
  assert.equal(userOf(CLAUDE.replace("/root/", "/home/node/")), "node");
  assert.equal(userOf(CLAUDE.replace("/root/", "/workspaces/project/")), undefined, "a folder that is not a home folder names no user");
  assert.equal(userOf(CLAUDE.replace("/root/", "/home/a/b/")), undefined);
  assert.equal(userOf(CLAUDE.replace("/root/", "/home/Some.Body/")), undefined, "not the form of a user name");
  assert.equal(userOf("/bin/sh"), undefined);
});

test("only something that has the form of a user name is handed to Docker as a user", async () => {
  for (const name of ["root", "vscode", "node", "_apt", "dev-1"]) assert.equal(isContainerUser(name), true, name);
  for (const name of ["", "0", "Root", "a b", "a;b", "-u", "--privileged", "x".repeat(33)]) assert.equal(isContainerUser(name), false, name);
  await assert.rejects(dockerClaudeAgentsJson("a1b2c3d4e5f6", CLAUDE, "--privileged"), /not a user name/);
  await assert.rejects(dockerReadUsage("a1b2c3d4e5f6", "/root/.code-command-center/usage/s.json", "a b"), /not a user name/);
});
