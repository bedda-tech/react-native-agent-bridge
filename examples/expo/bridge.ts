// Start the bridge in a dev build and let a test agent reach it over a socket. Not compiled
// here. In production builds, don't call this: with no agent, nothing is exposed.
import { createAgent } from "react-native-agent-bridge";
import { serveOverSocket } from "react-native-agent-bridge/mcp";
import { Alert } from "react-native";

export function startBridge(relayUrl: string) {
  const agent = createAgent({
    // A component marked `confirm` waits here for a person on the device.
    allow: (step) =>
      step.confirm
        ? new Promise<boolean>((resolve) =>
            Alert.alert("Agent wants to", step.confirm, [
              { text: "No", onPress: () => resolve(false) },
              { text: "Allow", onPress: () => resolve(true) },
            ])
          )
        : true,
  });
  const socket = new WebSocket(relayUrl);
  serveOverSocket(agent, socket); // React Native's WebSocket has send and addEventListener
  return agent;
}
