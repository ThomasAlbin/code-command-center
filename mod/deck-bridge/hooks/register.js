// Everything that Code Command Center runs inside Claude Code is in this file and
// in snapshot.js next to it.
//
// One hook on one event. `session.measure` fires after each turn and when a
// plan limit moves. It carries how much of the 5-hour and 7-day limits is
// used and when each resets. The hook writes those numbers to a small file
// that the Stream Deck plugin reads, and passes the event on unchanged.
//
// It reads no prompts, tool calls or project files, makes no network request,
// starts no program and changes nothing in the session.
import { fileFor, snapshot } from "./snapshot.js";

export function register(on) {
  on("session.measure", async ($, e, next) => {
    try {
      const text = snapshot(await $.clock.now(), e.rateLimits);
      const home = await $.env.get("HOME");
      if (text !== undefined && home !== undefined) {
        await $.fs.write(fileFor(home, await $.session.id()), text);
      }
    } catch {
      // A failed write must never disturb the session.
    }
    return next(e);
  });
}
