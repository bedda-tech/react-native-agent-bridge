#!/bin/bash
# runs on strix-halo: record the emulator while the model drives each tool set once
set -u
export PATH=$HOME/Android/Sdk/platform-tools:$HOME/.nvm/versions/node/v25.6.0/bin:$PATH
set -a; . ~/oliver-bench.env; set +a
cd /tmp/rnab-run
[ -d node_modules/ws ] || npm i ws --no-save >/dev/null 2>&1
for mode in bridge a11y; do
  adb shell rm -f /sdcard/cap-$mode.mp4
  adb shell screenrecord --time-limit 120 --size 540x1170 --bit-rate 2000000 /sdcard/cap-$mode.mp4 &
  REC=$!
  sleep 2
  BENCH_OUT=/tmp/rnab-run/capture-$mode.json node run.ts 1 anthropic/claude-sonnet-5.5 $mode 2>&1 | tail -c 600
  sleep 2
  adb shell pkill -2 screenrecord; wait $REC 2>/dev/null
  sleep 2
  adb pull /sdcard/cap-$mode.mp4 /tmp/rnab-run/cap-$mode.mp4
done
ls -la /tmp/rnab-run
