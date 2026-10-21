import { usePaseo, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { invalidPattern, preferences, type Preferences } from "../shared/settings";

type ProviderEntry = { provider: string; label: string; models: string[] };

const splitList = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function useProviders(): ProviderEntry[] {
  const paseo = usePaseo();
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  useEffect(() => {
    let live = true;
    paseo.providers
      .snapshot()
      .then(({ entries }) => {
        if (!live) return;
        setProviders(
          entries
            .filter((entry) => entry.enabled !== false && entry.status === "ready")
            .map((entry) => ({
              provider: entry.provider,
              label: entry.label ?? entry.provider,
              models: (entry.models ?? []).map((model) => model.id),
            })),
        );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [paseo]);
  return providers;
}

function Editor({
  saved,
  revision,
  save,
  reset,
  saving,
  saveError,
  theme,
}: {
  saved: Preferences;
  revision: string;
  save: (values: Preferences, revision: string) => Promise<boolean>;
  reset: () => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
  theme: PluginSurfaceProps["theme"];
}) {
  const providers = useProviders();
  const [draft, setDraft] = useState(saved);
  const [newPattern, setNewPattern] = useState("");
  // Bumped after a reset so uncontrolled inputs pick up the new values.
  const [generation, setGeneration] = useState(0);
  useEffect(() => setDraft(saved), [saved]);

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const patternError = newPattern ? invalidPattern(newPattern) : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  return (
    <>
      <SettingsSection title="Behavior">
        <SettingsCard>
          <SettingsSwitch
            label="Retry refused requests"
            hint="Switch models for the refused request only, then switch back."
            value={draft.enabled}
            onValueChange={(value) => set("enabled", value)}
          />
          <SettingsInput
            key={`attempts-${generation}`}
            label="Maximum attempts"
            hint="Total retries across all fallback models (1 to 50)."
            initialValue={String(draft.maxAttempts)}
            onChangeText={(text) => {
              const value = Number.parseInt(text, 10);
              if (Number.isInteger(value) && value >= 1 && value <= 50) set("maxAttempts", value);
            }}
          />
          <SettingsInput
            key={`delay-${generation}`}
            label="Delay between attempts (ms)"
            initialValue={String(draft.delayMs)}
            onChangeText={(text) => {
              const value = Number.parseInt(text, 10);
              if (Number.isInteger(value) && value >= 0 && value <= 60_000) set("delayMs", value);
            }}
          />
          <SettingsSelect
            label="Retry with"
            hint="The refused prompt is already in the conversation, so a short nudge is usually enough."
            value={draft.retryMode}
            options={[
              { label: "Retry message", value: "continue" },
              { label: "Last user message, verbatim", value: "resend" },
            ]}
            onValueChange={(value) => set("retryMode", value)}
          />
          {draft.retryMode === "continue" ? (
            <SettingsInput
              key={`message-${generation}`}
              label="Retry message"
              initialValue={draft.retryMessage}
              onChangeText={(text) => text.trim() && set("retryMessage", text)}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Fallback models"
        info="Comma-separated model IDs, tried in order. Add #thinking to set a thinking level, such as claude-sonnet-5-5#high. The agent's current model is skipped. Leave empty to use the provider's first three other models."
      >
        <SettingsCard>
          {providers.length === 0 ? (
            <SettingsRow label="No ready providers found on this host" />
          ) : (
            providers.map((entry) => (
              <SettingsInput
                key={`${entry.provider}-${generation}`}
                label={entry.label}
                hint={entry.models.length ? `Available: ${entry.models.join(", ")}` : undefined}
                placeholder="Automatic"
                initialValue={(draft.fallbackModels[entry.provider] ?? []).join(", ")}
                onChangeText={(text) => {
                  const models = splitList(text);
                  const next = { ...draft.fallbackModels };
                  if (models.length) next[entry.provider] = models;
                  else delete next[entry.provider];
                  set("fallbackModels", next);
                }}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Refusal patterns"
        info="Case-insensitive regular expressions matched against a failed turn's error, or a short assistant reply."
      >
        <SettingsCard>
          {draft.patterns.map((pattern, index) => (
            <SettingsAction
              key={`${index}-${pattern}`}
              label={pattern}
              actionLabel="Remove"
              onPress={() => set("patterns", draft.patterns.filter((_, i) => i !== index))}
            />
          ))}
          <SettingsInput
            key={`pattern-${generation}-${draft.patterns.length}`}
            label="Add pattern"
            placeholder="e.g. request was blocked"
            error={patternError}
            onChangeText={setNewPattern}
          />
          <SettingsAction
            label="Add the pattern above"
            actionLabel="Add"
            disabled={!newPattern.trim() || patternError !== null}
            onPress={() => {
              set("patterns", [...new Set([...draft.patterns, newPattern.trim()])]);
              setNewPattern("");
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Save">
        <SettingsCard>
          <SettingsAction
            label={dirty ? "You have unsaved changes" : "All changes saved"}
            error={saveError}
            actionLabel={saving ? "Saving…" : "Save"}
            disabled={!dirty || saving}
            onPress={() => void save(draft, revision)}
          />
          <SettingsAction
            label="Restore defaults"
            actionLabel="Reset"
            disabled={saving}
            onPress={() => void reset().then(() => setGeneration((value) => value + 1))}
          />
        </SettingsCard>
        <Text style={muted}>
          Model switching uses this host's local daemon credential, the same one the Paseo CLI uses.
        </Text>
      </SettingsSection>
    </>
  );
}

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const state = useSettings(preferences);
  if (state.status === "loading") return null;
  if (state.status === "ready") {
    return (
      <Editor
        saved={state.values}
        revision={state.revision}
        save={state.save}
        reset={state.reset}
        saving={state.saving}
        saveError={state.saveError}
        theme={theme}
      />
    );
  }
  return (
    <SettingsSection title="Settings unavailable">
      <SettingsCard>
        <SettingsAction
          label={state.error}
          actionLabel="Reset"
          onPress={() => void state.reset()}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
