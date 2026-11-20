#!/bin/sh
set -eu
# The read-only image uses a writable tmpfs; fail startup if it cannot be prepared.
mkdir -p /tmp/conf.d
test -w /tmp/conf.d
