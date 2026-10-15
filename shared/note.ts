import { z } from "zod";

export const NOTE_KIND = "refusal-fallback-note";

export const noteSchema = z.object({
  level: z.enum(["info", "success", "warning"]),
  text: z.string(),
});

export type Note = z.infer<typeof noteSchema>;
