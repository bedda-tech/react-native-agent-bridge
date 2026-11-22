// An Expo screen whose components are drivable by an agent. Not compiled in this repo (it needs
// react-native); it is the shape to copy. Each control calls useAgentComponent next to its own
// state, with the actions that change that state.
import { useState } from "react";
import { Switch, Text, View } from "react-native";
import { useAgentComponent } from "react-native-agent-bridge/react";

function Row({ group, label }: { group: string; label: string }) {
  const [on, setOn] = useState(false);
  useAgentComponent({
    component: "switch",
    label,
    row: group,
    state: { checked: on },
    actions: { setChecked: (v: boolean) => setOn(v) },
  });
  return (
    <View>
      <Text>{label}</Text>
      <Switch value={on} onValueChange={setOn} accessibilityLabel={label} />
    </View>
  );
}

export function NotificationsScreen() {
  return (
    <View>
      <Row group="Email" label="Deploy failures" />
      <Row group="Email" label="Weekly digest" />
    </View>
  );
}
