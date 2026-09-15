#!/usr/bin/env bash
# Builds a self-contained dcraw_emu for Linux from LibRaw source.
#
# The prebuilt bin/linux/dcraw_emu links libraw.so.23 and libgomp, neither of
# which exists on a clean machine. This build links LibRaw statically, drops
# OpenMP/JPEG/Jasper/LCMS, and asks for static libstdc++/libgcc, leaving glibc,
# libm and zlib (plus libstdc++ if libtool drops that flag — it is present on
# every distro, apt itself links it) as runtime dependencies.
#
# Build on the oldest glibc you intend to support (CI uses ubuntu-22.04).
# Usage: scripts/build-libraw-linux.sh <output-dir>
set -euo pipefail

LIBRAW_VERSION="0.21.4"
LIBRAW_SHA256="6be43f19397e43214ff56aab056bf3ff4925ca14012ce5a1538a172406a09e63"

out_dir="${1:?usage: build-libraw-linux.sh <output-dir>}"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL "https://www.libraw.org/data/LibRaw-${LIBRAW_VERSION}.tar.gz" -o "$work/libraw.tar.gz"
echo "${LIBRAW_SHA256}  $work/libraw.tar.gz" | sha256sum -c -
tar -xzf "$work/libraw.tar.gz" -C "$work"

cd "$work/LibRaw-${LIBRAW_VERSION}"
./configure \
  --disable-shared --enable-static \
  --disable-openmp --disable-jpeg --disable-jasper --disable-lcms \
  --enable-zlib --enable-examples \
  LDFLAGS="-static-libstdc++ -static-libgcc"
make -j"$(nproc)" bin/dcraw_emu

install -m 755 bin/dcraw_emu "$out_dir/dcraw_emu"
strip "$out_dir/dcraw_emu"

echo "Runtime dependencies:"
ldd "$out_dir/dcraw_emu"
if ldd "$out_dir/dcraw_emu" | grep -Eq 'libraw|libgomp|libjpeg|liblcms|libjasper|not found'; then
  echo "dcraw_emu still links a library absent on clean systems" >&2
  exit 1
fi
