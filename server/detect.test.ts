import assert from "node:assert/strict";
import test from "node:test";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { DEFAULT_PATTERNS } from "../shared/settings";
import { isRefusal } from "./detect";

type TurnEnded = PluginLifecycleEvents["agent.turn_ended"];
const blocked = "Compaction summary was blocked by the provider";

function event(outcome: TurnEnded["outcome"], timeline: TurnEnded["timeline"] = []): TurnEnded {
  return {
    agent: {
      id: "test", workspaceId: null, parentAgentId: null, provider: "opencode",
      cwd: "/test", title: null,
    },
    turnId: "test-turn",
    outcome,
    timeline,
  };
}

test("detects compaction blocks in failed-turn errors", () => {
  assert.equal(isRefusal(event({ kind: "failed", error: { message: blocked } }), DEFAULT_PATTERNS), true);
  assert.equal(isRefusal(event({ kind: "failed", error: { message: `[System Error] ${blocked.toLowerCase()}` } }), DEFAULT_PATTERNS), true);
});

test("detects a compaction block in the current failed turn's timeline", () => {
  assert.equal(isRefusal(event({ kind: "failed", error: { message: "Turn failed" } }, [
    { type: "user_message", text: "Continue." },
    { type: "compaction", status: "loading", trigger: "auto" },
    { type: "error", message: blocked },
  ]), DEFAULT_PATTERNS), true);
});

test("does not reuse a previous turn's compaction block", () => {
  assert.equal(isRefusal(event({ kind: "failed", error: { message: "Network timeout" } }, [
    { type: "user_message", text: "Old request" },
    { type: "error", message: blocked },
    { type: "user_message", text: "New request" },
    { type: "error", message: "Network timeout" },
  ]), DEFAULT_PATTERNS), false);
});

test("does not treat other compaction failures as refusals", () => {
  assert.equal(isRefusal(event({ kind: "failed", error: { message: "Compaction summary request timed out" } }), DEFAULT_PATTERNS), false);
});

test("does not retry canceled compaction turns", () => {
  assert.equal(isRefusal(event({ kind: "canceled", reason: "User canceled" }, [
    { type: "error", message: blocked },
  ]), DEFAULT_PATTERNS), false);
});

test("successful compaction does not trigger fallback", () => {
  assert.equal(isRefusal(event({ kind: "completed" }, [
    { type: "compaction", status: "completed", trigger: "auto" },
    { type: "assistant_message", text: "Continued successfully." },
  ]), DEFAULT_PATTERNS), false);
});
