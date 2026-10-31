// The settings panel of an Antigravity CLI quota key: one dropdown to choose
// whose limit the key shows. It talks only to the Stream Deck app, over the
// local connection Stream Deck hands every settings panel, and loads nothing
// from the network.

/** @type {HTMLSelectElement} */
const select = /** @type {HTMLSelectElement} */ (document.getElementById("group"));
/** @type {WebSocket | undefined} */
let socket;
let context = "";
/** The group this key shows, as the CLI names it. */
let group = "gemini";

/**
 * Stream Deck calls this once the panel has loaded.
 *
 * @param {string} port
 * @param {string} uuid identifies this panel and its key
 * @param {string} registerEvent
 * @param {string} _info
 * @param {string} actionInfo JSON describing the key, including its stored settings
 */
function connectElgatoStreamDeckSocket(port, uuid, registerEvent, _info, actionInfo) {
  const action = JSON.parse(actionInfo);
  context = uuid;
  group = groupOf(action.payload?.settings);
  showChoices([]);

  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.addEventListener("open", () => {
    send({ event: registerEvent, uuid });
    // Ask the plugin which groups the CLI has reported.
    send({ event: "sendToPlugin", action: action.action, context, payload: { request: "choices" } });
  });
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    if (data.event === "sendToPropertyInspector" && Array.isArray(data.payload?.groups)) {
      if (typeof data.payload.group === "string") group = data.payload.group;
      showChoices(data.payload.groups);
    }
  });
}
// Stream Deck looks for the function on the window.
Object.assign(window, { connectElgatoStreamDeckSocket });

select.addEventListener("change", () => {
  group = select.value;
  send({ event: "setSettings", context, payload: { group } });
});

/**
 * @param {Array<{ id: string, label: string }>} groups
 */
function showChoices(groups) {
  select.replaceChildren();
  for (const choice of groups) {
    if (typeof choice?.id === "string" && typeof choice.label === "string") addOption(choice.id, choice.label);
  }
  if (![...select.options].some((option) => option.value === group)) addOption(group, group);
  select.value = group;
}

/**
 * @param {string} value
 * @param {string} label
 */
function addOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.title = value;
  select.append(option);
}

/**
 * @param {unknown} settings
 * @returns {string}
 */
function groupOf(settings) {
  const value = settings !== null && typeof settings === "object" ? /** @type {{ group?: unknown }} */ (settings).group : undefined;
  return typeof value === "string" && value !== "" ? value : "gemini";
}

/** @param {object} message */
function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
