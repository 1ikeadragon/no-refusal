import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences, type Preferences } from "./shared/settings";
import { closeDaemon } from "./server/daemon";
import { onAgentGone, onTurnEnded, stopAll } from "./server/fallback";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  let prefs: Preferences = preferences.schema.parse({});
  const apply = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status === "ready") prefs = state.values;
    else console.error(`[refusal-fallback] Invalid settings, using the last good values: ${state.error}`);
  };
  void settings.read().then(apply);

  const offs = [
    settings.subscribe(apply),
    server.on("agent.turn_ended", (event, { paseo }) => onTurnEnded(event, paseo, prefs)),
    server.on("agent.closed", ({ agent }) => onAgentGone(agent.id)),
    server.on("agent.archived", ({ agent }) => onAgentGone(agent.id)),
  ];
  return async () => {
    for (const off of offs) off();
    await stopAll();
    await closeDaemon();
  };
}
