import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// Refusal messages seen from common providers. Matched case-insensitively against a
// failed turn's error, or against a short assistant reply.
export const DEFAULT_PATTERNS = [
  "Provider blocked the response",
  "violat\\w* (our|the) usage polic",
  "cyber-related safeguards",
  "stop_reason\\W+refusal",
  "finish_?reason\\W+(content_filter|safety|prohibited_content)",
  "content management policy",
  "blocked due to (safety|prohibited_content)",
];

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    // Total retries across all fallback models for one refused request.
    maxAttempts: z.number().int().min(1).max(50).default(10),
    delayMs: z.number().int().min(0).max(60_000).default(1500),
    // "continue" sends retryMessage, since the refused prompt is already in the history.
    // "resend" sends the last user message again, verbatim.
    retryMode: z.enum(["continue", "resend"]).default("continue"),
    retryMessage: z.string().min(1).default("Continue."),
    // Model IDs keyed by agent provider, tried in order. The agent's own model is skipped.
    // Append "#<thinking>" to pick a thinking level, e.g. "claude-sonnet-5-5#high".
    fallbackModels: z.record(z.string(), z.array(z.string().min(1))).default({}),
    patterns: z.array(z.string().min(1)).default(DEFAULT_PATTERNS),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;

// A fallback entry is a model ID, optionally followed by "#" and a thinking option ID,
// such as "claude-sonnet-5-5#high".
export type Candidate = { model: string; thinking: string | null };

export function parseCandidate(entry: string): Candidate {
  const at = entry.lastIndexOf("#");
  if (at <= 0 || at === entry.length - 1) return { model: entry.trim(), thinking: null };
  return { model: entry.slice(0, at).trim(), thinking: entry.slice(at + 1).trim() };
}

export const candidateLabel = ({ model, thinking }: Candidate) =>
  thinking ? `${model} (${thinking})` : model;

export function invalidPattern(pattern: string): string | null {
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
