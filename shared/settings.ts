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
    fallbackModels: z.record(z.string(), z.array(z.string().min(1))).default({}),
    patterns: z.array(z.string().min(1)).default(DEFAULT_PATTERNS),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;

export function invalidPattern(pattern: string): string | null {
  try {
    new RegExp(pattern, "i");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
