// The settings panel of a session key: one dropdown to reserve the key for a
// project. It talks only to the Stream Deck app, over the local connection
// Stream Deck hands every settings panel, and loads nothing from the network.

/** @type {HTMLSelectElement} */
const select = /** @type {HTMLSelectElement} */ (document.getElementById("pin"));
/** @type {WebSocket | undefined} */
let socket;
let context = "";
/** The project this key is reserved for; empty for an automatic key. */
let pin = "";

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
  pin = pinOf(action.payload?.settings);
  showChoices([]);

  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.addEventListener("open", () => {
    send({ event: registerEvent, uuid });
    // Ask the plugin which projects are running.
    send({ event: "sendToPlugin", action: action.action, context, payload: { request: "choices" } });
  });
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    if (data.event === "sendToPropertyInspector" && Array.isArray(data.payload?.projects)) {
      if (typeof data.payload.pin === "string") pin = data.payload.pin;
      showChoices(data.payload.projects);
    } else if (data.event === "didReceiveSettings") {
      // The key was switched on the device while the panel was open.
      pin = pinOf(data.payload?.settings);
      if (![...select.options].some((option) => option.value === pin)) addOption(pin, labelOf(pin), false);
      select.value = pin;
    }
  });
}
// Stream Deck looks for the function on the window.
Object.assign(window, { connectElgatoStreamDeckSocket });

select.addEventListener("change", () => {
  pin = select.value;
  send({ event: "setSettings", context, payload: pin === "" ? {} : { pin } });
});

/**
 * @param {Array<{ id: string, label: string, running: boolean }>} projects
 */
function showChoices(projects) {
  select.replaceChildren();
  addOption("", "Automatic", true);
  for (const project of projects) {
    if (typeof project?.id !== "string" || typeof project.label !== "string") continue;
    addOption(project.id, project.label, project.running !== false);
  }
  if (pin !== "" && ![...select.options].some((option) => option.value === pin)) addOption(pin, labelOf(pin), false);
  select.value = pin;
}

/**
 * @param {string} value
 * @param {string} label
 * @param {boolean} running
 */
function addOption(value, label, running) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = running ? label : `${label} (not running)`;
  option.title = value;
  select.append(option);
}

/**
 * @param {unknown} settings
 * @returns {string}
 */
function pinOf(settings) {
  const value = settings !== null && typeof settings === "object" ? /** @type {{ pin?: unknown }} */ (settings).pin : undefined;
  return typeof value === "string" ? value : "";
}

/**
 * @param {string} folder
 * @returns {string} its last segment
 */
function labelOf(folder) {
  return folder.split("/").filter(Boolean).pop() ?? folder;
}

/** @param {object} message */
function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
