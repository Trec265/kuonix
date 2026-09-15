#!/usr/bin/env bash
# Clean-machine test for the Linux .deb. Run inside a fresh ubuntu container
# with the repository mounted at /work and a Node binary mounted at /opt/node
# (used only to drive the test; it is never on the app's PATH):
#
#   docker run --rm -v "$PWD:/work" -v "<node dir>:/opt/node:ro" ubuntu:24.04 \
#     bash /work/frontend/scripts/smoke-linux-container.sh
#
# Installs the package through apt (which resolves its declared dependencies),
# plus Xvfb to host the window headlessly, confirms no Java exists on the
# machine, then runs scripts/smoke-packaged.mjs against /opt/Kuonix.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

deb="$(ls /work/frontend/release/*.deb | head -n 1)"
apt-get update -qq
apt-get install -y -qq "$deb" xvfb xauth >/dev/null

if command -v java >/dev/null 2>&1 || ls /usr/lib/jvm >/dev/null 2>&1; then
  echo "FAIL  container is not clean: a Java runtime is installed" >&2
  exit 1
fi
echo "PASS  no system Java present"

KUONIX_SMOKE_EXE=/opt/Kuonix/kuonix \
KUONIX_SMOKE_RESOURCES=/opt/Kuonix/resources \
KUONIX_SMOKE_WRAPPER="xvfb-run -a" \
  /opt/node/bin/node /work/frontend/scripts/smoke-packaged.mjs
