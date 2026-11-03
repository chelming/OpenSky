#!/bin/bash
# Run OpenSky's tests in a container: no Raspberry Pi, no screen, nothing installed on this computer but Docker.
#   tools/docker-test.sh                              unit tests + every screen scenario (tools/test-all.sh)
#   tools/docker-test.sh scenario tools/scenarios/google.js
#   tools/docker-test.sh node tools/test-pickup.js    any single command
#   tools/docker-test.sh build                        rebuild the image (needed only when Dockerfile.test changes)
# The repo is mounted into the container, so your edits are tested without rebuilding. Screenshots land in tools/out/.
# The container user is uid 1000; if yours differs, tools/out/ must be writable by everyone.
# If the build can't resolve names, try OPENSKY_DOCKER_BUILD_ARGS="--network host".
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${OPENSKY_TEST_IMAGE:-opensky-test}"
if [ "${1:-}" = build ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  docker build ${OPENSKY_DOCKER_BUILD_ARGS:-} -f Dockerfile.test -t "$IMAGE" .
  [ "${1:-}" = build ] && shift
fi
mkdir -p tools/out
# --shm-size: Electron needs more than Docker's 64 MB /dev/shm
exec docker run --rm --shm-size=1g -v "$PWD:/opensky" "$IMAGE" "$@"
