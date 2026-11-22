# bridge-bench: Expo example for the model-driven benchmark

A project-settings screen (3 tabs, 24 members, a confirm dialog, switches) whose controls call
`useAgentComponent`. Built locally for Android (`expo prebuild` + Gradle; no EAS). It talks to the runner in
`bench/model/` over `ws://10.0.2.2:8799/bridge` and posts saved settings to `http://10.0.2.2:8799/saved`.
Cleartext is enabled for that, so this app is a test app: do not ship it.
