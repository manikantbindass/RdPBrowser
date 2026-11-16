#!/usr/bin/env bash
# Disposable namespace test. Uses a loopback upstream observer and short-lived TLS cert.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
if [[ ${1:-} != isolated ]]; then
  export RSX_PARENT_NETWORK
  RSX_PARENT_NETWORK=$(readlink /proc/self/ns/net)
  exec unshare --net bash "$0" isolated
fi
[[ ${RSX_PARENT_NETWORK:-} != "$(readlink /proc/self/ns/net)" && -n ${RSX_PARENT_NETWORK:-} ]]
ip link set lo up
work=$(mktemp -d)
umask 077
mkdir "$work/logs"
backend_pid=''
edge_pid=''
cleanup() {
  [[ -z $edge_pid ]] || kill "$edge_pid" 2>/dev/null || true
  [[ -z $backend_pid ]] || kill "$backend_pid" 2>/dev/null || true
  wait || true
  rm -rf -- "$work"
}
trap cleanup EXIT
openssl req -new -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=scim.fixture.test -addext subjectAltName=DNS:scim.fixture.test \
  -keyout "$work/tls.key" -out "$work/tls.crt" >"$work/cert.log" 2>&1
sed -e 's/backend:3000/127.0.0.1:16300/' -e 's/listen 443 ssl;/listen 127.0.0.1:16443 ssl;/' \
  -e 's/listen 127.0.0.1:80;/listen 127.0.0.1:16080;/' -e "s/\${SCIM_DOMAIN}/scim.fixture.test/g" \
  -e "s@/etc/nginx/certs/@$work/@g" "$root/nginx/scim.conf.template" > "$work/scim.conf"
cat > "$work/nginx.conf" <<EOF
worker_processes 1;
pid $work/nginx.pid;
error_log stderr;
events {}
http { include $work/scim.conf; }
EOF
python3 - <<'PY' >"$work/backend.log" 2>&1 &
from http.server import BaseHTTPRequestHandler, HTTPServer
import json

class Observer(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = json.dumps({
            'path': self.path,
            'protocol': self.headers.get('X-Forwarded-Proto'),
            'source': self.headers.get('X-Forwarded-For'),
            'host': self.headers.get('Host'),
            'has_fixture_authorization': self.headers.get('Authorization') == 'Bearer fixture-only'
        }).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

HTTPServer(('127.0.0.1', 16300), Observer).serve_forever()
PY
backend_pid=$!
nginx -t -p "$work" -c "$work/nginx.conf"
nginx -p "$work" -c "$work/nginx.conf" -g 'daemon off;' > "$work/nginx.log" 2>&1 &
edge_pid=$!
query() { curl --silent --show-error --max-time 3 --cacert "$work/tls.crt" --resolve scim.fixture.test:16443:127.0.0.1 --noproxy '*' "$@"; }
ready=false
for _ in {1..20}; do
  if query -o /dev/null https://scim.fixture.test:16443/ 2>/dev/null && \
    curl --silent --fail --max-time 3 --noproxy '*' http://127.0.0.1:16300/ > /dev/null; then ready=true;break;fi
  sleep 0.2
done
[[ $ready == true ]]
curl --silent --fail --noproxy '*' http://127.0.0.1:16080/health > /dev/null
query --fail -H 'X-Forwarded-Proto: http' -H 'X-Forwarded-For: 192.0.2.5' -H 'Authorization: Bearer fixture-only' \
  https://scim.fixture.test:16443/scim/v2/00000000-0000-4000-8000-000000000001/Users | python3 -c \
  'import json,sys; x=json.load(sys.stdin); assert x == {"path":"/scim/v2/00000000-0000-4000-8000-000000000001/Users","protocol":"https","source":"127.0.0.1","host":"scim.fixture.test","has_fixture_authorization":True}'
echo 'PASS SCIM HTTPS routing, TLS verification, trusted header overwrite and authorization forwarding'
for path in / /admin/ /health /api/v1/auth/login /api/v1/organization /socket.io/ /scim/v2/../api/v1/organization; do
  [[ $(query --path-as-is -o /dev/null -w '%{http_code}' "https://scim.fixture.test:16443$path") == 404 ]]
done
echo 'PASS public SCIM listener denies control, admin, health and traversal paths'
