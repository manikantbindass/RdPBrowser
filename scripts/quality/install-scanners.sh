#!/usr/bin/env bash
set -euo pipefail
destination=${1:?Provide a private tool directory}
mkdir -p "$destination"
cd "$destination"
curl -fsSL https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz -o trivy_0.76.2_Linux-64bit.tar.gz
printf '%s\n' 'bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf  trivy_0.76.2_Linux-64bit.tar.gz' | sha256sum -c -
tar -xzf trivy_0.76.2_Linux-64bit.tar.gz trivy
curl -fsSL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz -o gitleaks_8.30.1_linux_x64.tar.gz
printf '%s\n' '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  gitleaks_8.30.1_linux_x64.tar.gz' | sha256sum -c -
tar -xzf gitleaks_8.30.1_linux_x64.tar.gz gitleaks
./trivy --version
./gitleaks version
