#!/bin/bash
# Entrypoint of the test image (Dockerfile.test). The repo is mounted at /opensky by tools/docker-test.sh.
#   (no arguments)           tools/test-all.sh
#   scenario <file.js>       one screen scenario on the off-screen compositor
#   anything else            run as given, e.g.  node tools/test-pickup.js
set -euo pipefail
[ -f /opensky/tools/harness.js ] || { echo "The OpenSky folder is not mounted at /opensky — run tools/docker-test.sh."; exit 1; }
cd /opensky
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
git config --global --add safe.directory /opensky
# wire the mounted repo into the image's MagicMirror (the same step as on a Pi: tools/dev-setup.sh)
tools/dev-setup.sh "$OPENSKY_MM" >/dev/null
# git inside the container must never write to the repo
export GIT_OPTIONAL_LOCKS=0
# there is no desktop session in the container, so the headless compositor gets the first name, wayland-0
export OPENSKY_TEST_DISPLAY=wayland-0
# no IPv6 in the container: "localhost" must mean 127.0.0.1 for both the server and the calendar fixtures it fetches
export OPENSKY_ADDRESS=127.0.0.1

if [ "${1:-}" = scenario ]; then
  [ -n "${2:-}" ] || { echo "usage: scenario tools/scenarios/<name>.js"; exit 2; }
  tools/headless.sh start >/dev/null
  trap 'tools/headless.sh stop >/dev/null' EXIT
  node tools/harness.js "$2"
  exit $?
fi
[ $# -gt 0 ] || set -- tools/test-all.sh
exec "$@"
