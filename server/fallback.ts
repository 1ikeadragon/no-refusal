import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { NOTE_KIND, type Note } from "../shared/note";
import { candidateLabel, parseCandidate, type Candidate, type Preferences } from "../shared/settings";
import { daemon } from "./daemon";
import { isRefusal, lastUserMessage, turnPrompt } from "./detect";

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];
type AttemptResult = { kind: "event"; event: TurnEnded } | { kind: "timeout" } | { kind: "closed" };

const ATTEMPT_TIMEOUT_MS = 60 * 60 * 1000;
// Used when no fallback list is configured for a provider.
const AUTO_FALLBACK_COUNT = 3;

// Agents with a fallback run in progress. Their turn_ended events go to the
// waiting run instead of starting another one.
const active = new Map<string, (result: AttemptResult) => void>();
const running = new Set<Promise<void>>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function note(paseo: PaseoApi, agentId: string, data: Note): Promise<void> {
  try {
    await paseo.agents
      .ref(agentId)
      .timeline.append({ type: "plugin", id: randomUUID(), kind: NOTE_KIND, version: 1, data });
  } catch (error) {
    console.error("[refusal-fallback] Could not append timeline note", error);
  }
  console.log(`[refusal-fallback] ${agentId}: ${data.text}`);
}

function nextTurn(agentId: string): Promise<AttemptResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), ATTEMPT_TIMEOUT_MS);
    active.set(agentId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function candidates(
  paseo: PaseoApi,
  prefs: Preferences,
  provider: string,
  cwd: string,
  current: string | null,
): Promise<Candidate[]> {
  const configured = prefs.fallbackModels[provider];
  if (configured?.length) {
    return [...new Set(configured)].map(parseCandidate).filter((entry) => entry.model !== current);
  }
  const { models } = await paseo.providers.listModels(provider, { cwd });
  return (models ?? [])
    .filter((model) => model.isSelectable !== false && model.id !== current)
    .slice(0, AUTO_FALLBACK_COUNT)
    .map((model) => ({ model: model.id, thinking: null }));
}

async function switchTo(agentId: string, { model, thinking }: Candidate): Promise<void> {
  const client = await daemon();
  await client.setAgentModel(agentId, model);
  // Clear the previous attempt's thinking level when none is specified.
  // If an explicit level is rejected, skip this attempt rather than silently use another.
  await client.setAgentThinkingOption(agentId, thinking);
}

async function restore(
  agentId: string,
  model: string | null,
  thinking: string | null | undefined,
): Promise<void> {
  const client = await daemon();
  await client.setAgentModel(agentId, model);
  if (thinking === undefined) return;
  const after = await client.fetchAgent(agentId);
  if (after && after.agent.thinkingOptionId !== thinking) {
    await client.setAgentThinkingOption(agentId, thinking).catch(() => undefined);
  }
}

async function runFallback(event: TurnEnded, paseo: PaseoApi, prefs: Preferences): Promise<void> {
  const agentId = event.agent.id;
  const client = await daemon();
  const snapshot = await client.fetchAgent(agentId);
  if (!snapshot) return;
  const originalModel = snapshot.agent.model;
  const originalThinking = snapshot.agent.thinkingOptionId;
  const original = originalModel ?? "the original model";
  const models = await candidates(paseo, prefs, event.agent.provider, event.agent.cwd, originalModel);

  if (models.length === 0) {
    await note(paseo, agentId, {
      level: "warning",
      text: `Request refused, and provider "${event.agent.provider}" has no other models to fall back to.`,
    });
    return;
  }

  const prompt =
    prefs.retryMode === "resend"
      ? (lastUserMessage(event.timeline) ?? prefs.retryMessage)
      : prefs.retryMessage;

  const tried: string[] = [];
  let outcome: "recovered" | "exhausted" | "stopped" = "exhausted";
  let recoveredOn: string | null = null;

  try {
    await note(paseo, agentId, {
      level: "info",
      text: `${originalModel ?? "The model"} refused this request. Retrying on ${models.map(candidateLabel).join(", ")} (up to ${prefs.maxAttempts} attempts), then switching back.`,
    });

    for (let attempt = 1; attempt <= prefs.maxAttempts; attempt++) {
      const candidate = models[(attempt - 1) % models.length]!;
      const model = candidateLabel(candidate);
      if (attempt > 1 && prefs.delayMs > 0) await sleep(prefs.delayMs);

      try {
        await switchTo(agentId, candidate);
      } catch (error) {
        console.error(`[refusal-fallback] Could not switch to ${model}`, error);
        continue;
      }
      tried.push(model);

      const result = nextTurn(agentId);
      await paseo.agents.ref(agentId).send(prompt);
      const settled = await result;
      if (settled.kind !== "event" || settled.event.outcome.kind === "canceled") {
        outcome = "stopped";
        break;
      }

      const ended = settled.event;
      const sent = turnPrompt(ended);
      if (sent !== null && !sent.includes(prompt.trim())) {
        // Someone sent their own message mid-fallback; let them drive.
        outcome = "stopped";
        break;
      }
      if (isRefusal(ended, prefs.patterns)) continue;
      if (ended.outcome.kind === "completed") {
        outcome = "recovered";
        recoveredOn = model;
        break;
      }
      // A non-refusal failure, such as an unavailable model. Move on to the next one.
      console.error(
        `[refusal-fallback] ${model} failed without a refusal:`,
        ended.outcome.kind === "failed" ? ended.outcome.error.message : ended.outcome.kind,
      );
    }
  } finally {
    active.delete(agentId);
    try {
      await restore(agentId, originalModel, originalThinking);
    } catch (error) {
      console.error("[refusal-fallback] Could not restore the original model", error);
      await note(paseo, agentId, {
        level: "warning",
        text: `Could not switch back to ${original}. Check the model picker.`,
      });
    }
  }

  const back = `Switched back to ${original}.`;
  if (outcome === "recovered") {
    const count = tried.length === 1 ? "1 attempt" : `${tried.length} attempts`;
    await note(paseo, agentId, { level: "success", text: `${recoveredOn} answered after ${count}. ${back}` });
  } else if (outcome === "stopped") {
    await note(paseo, agentId, { level: "info", text: `Fallback stopped. ${back}` });
  } else {
    const where = tried.length ? ` on ${[...new Set(tried)].join(", ")}` : "";
    await note(paseo, agentId, {
      level: "warning",
      text: `Still refused after ${tried.length} attempts${where}. ${back} Rephrase the request, or report a false positive to the model provider.`,
    });
  }
}

export function onTurnEnded(event: TurnEnded, paseo: PaseoApi, prefs: Preferences): void {
  const agentId = event.agent.id;
  const waiter = active.get(agentId);
  if (waiter) {
    waiter({ kind: "event", event });
    return;
  }
  if (!prefs.enabled || !isRefusal(event, prefs.patterns)) return;
  // Claim the agent now so another event cannot start a second run, and run the
  // retry loop detached because hooks time out after 30 seconds.
  active.set(agentId, () => undefined);
  const run = runFallback(event, paseo, prefs)
    .catch(async (error) => {
      console.error("[refusal-fallback] Fallback run failed", error);
      await note(paseo, agentId, {
        level: "warning",
        text: `Fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    })
    .finally(() => {
      active.delete(agentId);
      running.delete(run);
    });
  running.add(run);
}

export function onAgentGone(agentId: string): void {
  active.get(agentId)?.({ kind: "closed" });
}

// Stops waiting on every run and lets each one switch its agent back.
export async function stopAll(): Promise<void> {
  for (const waiter of active.values()) waiter({ kind: "closed" });
  await Promise.race([Promise.allSettled(running), sleep(10_000)]);
}
