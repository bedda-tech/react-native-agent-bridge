// Project-settings screen for the model-driven benchmark (see bench/model/). Same task as UI SDK's
// agent benchmark: three tabs, 24 members with a menu on each row, a confirm dialog, switches
// grouped by channel. Plain React Native components; every control also registers itself with the
// bridge, next to its own state. An agent can use either path: the bridge (snapshot / act over a
// socket) or the Android accessibility tree (uiautomator + tap + type).
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAgentComponent } from "react-native-agent-bridge/react";
import { createAgent } from "react-native-agent-bridge";
import { serveOverSocket } from "react-native-agent-bridge/mcp";

// The test runner on the machine that hosts the emulator. 10.0.2.2 is the emulator's name for it.
const HOST = "10.0.2.2:8799";

const NAMES = [
  "Ada Lovelace", "Alan Turing", "Grace Hopper", "Priya Shah", "Tom Becker", "Linus Berg", "Mara Ionescu", "Joon Park",
  "Sofia Rossi", "Ken Thompson", "Radia Perlman", "Dennis Ritchie", "Barbara Liskov", "Edsger Dijkstra", "Margaret Hamilton",
  "Leslie Lamport", "Frances Allen", "Donald Knuth", "Shafi Goldwasser", "Vint Cerf", "Katherine Johnson", "Tim Berners",
  "Hedy Lamarr", "John McCarthy",
];
type Role = "member" | "admin";
type Tab = "General" | "Members" | "Notifications";
const TABS: Tab[] = ["General", "Members", "Notifications"];

function Btn({ label, onPress, a11y, style }: { label: string; onPress: () => void; a11y?: string; style?: object }) {
  return (
    <TouchableOpacity style={[s.btn, style]} onPress={onPress} accessibilityLabel={a11y ?? label} accessibilityRole="button">
      <Text>{label}</Text>
    </TouchableOpacity>
  );
}

function SwitchRow({ group, label, value, set }: { group: string; label: string; value: boolean; set: (v: boolean) => void }) {
  useAgentComponent({ component: "switch", label, row: group, state: { checked: value }, actions: { setChecked: set } });
  return (
    <View style={s.row}>
      <Text>{label}</Text>
      <Switch value={value} onValueChange={set} accessibilityLabel={label} />
    </View>
  );
}

function MemberRow(p: { name: string; role: Role; open: boolean; toggle: () => void; setRole: (r: Role) => void; ask: () => void }) {
  useAgentComponent({
    component: "menu", label: "Member actions", row: p.name, state: { role: p.role },
    actions: { makeAdmin: () => p.setRole("admin"), remove: p.ask },
  });
  return (
    <View>
      <View style={s.row}>
        <Text>{p.name}</Text>
        <Text>{p.role}</Text>
        <Btn label="⋮" a11y={`Actions for ${p.name}`} onPress={p.toggle} />
      </View>
      {p.open && (
        <View style={s.row}>
          <Btn label="Make admin" onPress={() => p.setRole("admin")} />
          <Btn label="Remove" onPress={p.ask} />
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("General");
  const [name, setName] = useState("Apollo");
  const [visibility, setVisibility] = useState("Private");
  const [picker, setPicker] = useState(false);
  const [members, setMembers] = useState(NAMES.map((n) => ({ name: n, role: "member" as Role })));
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null); // member to remove
  const [email, setEmail] = useState<Record<string, boolean>>({ "Deploy failures": false, "Weekly digest": true, Billing: true });
  const [slack, setSlack] = useState<Record<string, boolean>>({ "Deploy failures": true, Mentions: true });

  const save = () => {
    const body = {
      name, visibility,
      admins: members.filter((m) => m.role === "admin").map((m) => m.name),
      members: members.map((m) => m.name), email, slack,
    };
    fetch(`http://${HOST}/saved`, { method: "POST", body: JSON.stringify(body) }).catch(() => {});
  };

  // One bridge over a socket to the runner. Dev/test builds only; a production build never calls this.
  useEffect(() => {
    const agent = createAgent({ settle: 150 });
    const ws = new WebSocket(`ws://${HOST}/bridge`);
    serveOverSocket(agent, ws as never);
    return () => ws.close();
  }, []);

  useAgentComponent({
    component: "tabs", label: "Settings", state: { value: tab },
    items: TABS.map((v) => ({ value: v, label: v })),
    actions: { setValue: (v: string) => { setTab(v as Tab); setMenu(null); } },
  });
  useAgentComponent({ component: "button", label: "Save", actions: { press: save } });

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.h}>Project settings</Text>
      <View style={s.row}>
        {TABS.map((t) => <Btn key={t} label={t} onPress={() => { setTab(t); setMenu(null); }} />)}
      </View>
      {dialog ? (
        <Dialog
          title={`Remove ${dialog}?`}
          cancel={() => setDialog(null)}
          confirm={() => { setMembers((ms) => ms.filter((m) => m.name !== dialog)); setDialog(null); }}
        />
      ) : (
        <>
          {tab === "General" && (
            <>
              <NameField value={name} set={setName} />
              <VisibilityPicker value={visibility} set={(v) => { setVisibility(v); setPicker(false); }} open={picker} toggle={() => setPicker(!picker)} />
            </>
          )}
          {tab === "Members" && members.map((m) => (
            <MemberRow
              key={m.name} name={m.name} role={m.role} open={menu === m.name}
              toggle={() => setMenu(menu === m.name ? null : m.name)}
              setRole={(r) => { setMembers((ms) => ms.map((x) => (x.name === m.name ? { ...x, role: r } : x))); setMenu(null); }}
              ask={() => { setMenu(null); setDialog(m.name); }}
            />
          ))}
          {tab === "Notifications" && (
            <>
              <Text style={s.h}>Email</Text>
              {Object.keys(email).map((k) => <SwitchRow key={`e${k}`} group="Email" label={k} value={email[k]} set={(v) => setEmail({ ...email, [k]: v })} />)}
              <Text style={s.h}>Slack</Text>
              {Object.keys(slack).map((k) => <SwitchRow key={`s${k}`} group="Slack" label={k} value={slack[k]} set={(v) => setSlack({ ...slack, [k]: v })} />)}
            </>
          )}
          <Btn label="Save" onPress={save} />
        </>
      )}
    </ScrollView>
  );
}

function NameField({ value, set }: { value: string; set: (v: string) => void }) {
  useAgentComponent({ component: "text-field", label: "Project name", state: { value }, actions: { setValue: set } });
  return (
    <View>
      <Text>Project name</Text>
      <TextInput style={s.input} value={value} onChangeText={set} accessibilityLabel="Project name" />
    </View>
  );
}

function VisibilityPicker({ value, set, open, toggle }: { value: string; set: (v: string) => void; open: boolean; toggle: () => void }) {
  const items = ["Private", "Internal", "Public"];
  useAgentComponent({
    component: "picker", label: "Visibility", state: { value },
    items: items.map((v) => ({ value: v, label: v })), actions: { setValue: set },
  });
  return (
    <View>
      <Text>Visibility</Text>
      <Btn label={value} onPress={toggle} />
      {open && items.map((v) => <Btn key={v} label={v} onPress={() => set(v)} />)}
    </View>
  );
}

function Dialog({ title, cancel, confirm }: { title: string; cancel: () => void; confirm: () => void }) {
  useAgentComponent({
    component: "dialog", label: title, row: title,
    actions: { remove: confirm, cancel },
  });
  return (
    <View>
      <Text>{title}</Text>
      <View style={s.row}>
        <Btn label="Cancel" onPress={cancel} />
        <Btn label="Remove" onPress={confirm} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { paddingTop: 56, paddingHorizontal: 12, paddingBottom: 40 },
  h: { fontSize: 18, fontWeight: "600", marginVertical: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: "#888", borderRadius: 6, margin: 3 },
  input: { borderWidth: 1, borderColor: "#888", borderRadius: 6, padding: 8 },
});
