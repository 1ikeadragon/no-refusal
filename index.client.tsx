import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { SettingsScreen } from "./client/settings";
import { NOTE_KIND, noteSchema, type Note } from "./shared/note";

function NoteRow({ item, theme }: PluginTimelineItemProps<Note>) {
  const { colors } = theme;
  const tone =
    item.data.level === "success"
      ? colors.statusSuccess
      : item.data.level === "warning"
        ? colors.statusWarning
        : colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: tone }} />
      <Text style={{ flex: 1, color: colors.foregroundMuted, fontSize: 13 }}>
        Refusal fallback: {item.data.text}
      </Text>
    </View>
  );
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addTimelineRenderer({
      kind: NOTE_KIND,
      version: 1,
      schema: noteSchema,
      Component: NoteRow,
    }),
    client.addSettingsScreen({
      id: "settings",
      title: "Refusal fallback",
      icon: "ShieldAlert",
      Component: SettingsScreen,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
