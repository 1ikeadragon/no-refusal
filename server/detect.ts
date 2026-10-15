import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];

// Refusals that arrive as a normal assistant reply are short; longer text that
// mentions a pattern is more likely a discussion of it.
const MAX_REFUSAL_REPLY_CHARS = 800;

export function currentTurn(timeline: readonly AgentTimelineItem[]): readonly AgentTimelineItem[] {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.type === "user_message") return timeline.slice(i);
  }
  return timeline;
}

function compile(patterns: readonly string[]): RegExp[] {
  return patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern, "i")];
    } catch {
      return [];
    }
  });
}

export function isRefusal(event: TurnEnded, patterns: readonly string[]): boolean {
  const regexes = compile(patterns);
  const matches = (text: string) => regexes.some((regex) => regex.test(text));
  const turn = currentTurn(event.timeline);

  if (event.outcome.kind === "failed") {
    if (matches(event.outcome.error.message)) return true;
    return turn.some((item) => item.type === "error" && matches(item.message));
  }
  if (event.outcome.kind === "completed") {
    const last = turn.at(-1);
    return (
      last?.type === "assistant_message" &&
      last.text.length <= MAX_REFUSAL_REPLY_CHARS &&
      matches(last.text)
    );
  }
  return false;
}

export function turnPrompt(event: TurnEnded): string | null {
  const first = currentTurn(event.timeline)[0];
  return first?.type === "user_message" ? first.text : null;
}

export function lastUserMessage(timeline: readonly AgentTimelineItem[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item?.type === "user_message" && item.text.trim()) return item.text;
  }
  return null;
}
