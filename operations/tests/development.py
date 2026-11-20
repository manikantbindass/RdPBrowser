"""Smoke-test the documented development override in lab.sh's private namespaces."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.request

work = Path(sys.argv[1])
if (not os.environ.get("RSX_OPERATIONS_PARENT") or os.readlink("/proc/self/ns/net") == os.environ["RSX_OPERATIONS_PARENT"]
        or not str(work).startswith("/tmp/tmp.") or os.environ.get("DOCKER_HOST") != "unix://" + str(work / "docker.sock")):
    raise RuntimeError("Use the isolated lab.sh entrypoint")
repo = Path(__file__).resolve().parents[2]
environment = work / "development.env"
values = {"NODE_ENV": "development", "DOMAIN": "localhost", "CORS_ORIGINS": "http://127.0.0.1:18180", "DEV_ADMIN_PORT": "18180",
          "VPN_REQUIRED": "false", "DB_NETWORK_TRUSTED": "true"}
values.update({key: secrets.token_hex(32) for key in ("DB_PASS", "DB_RUNTIME_PASS", "JWT_SECRET", "JWT_REFRESH_SECRET")})
for key, image in (("BACKEND_IMAGE", "remoteshield-backend:phase12-a"), ("EDGE_IMAGE", "remoteshield-nginx:phase12")):
    values[key] = subprocess.check_output(["docker", "image", "inspect", image, "--format", "{{.Id}}"], text=True).strip()
environment.write_text("\n".join(key + "=" + value for key, value in values.items()) + "\n")
environment.chmod(0o600)
compose = ["docker", "compose", "--project-name", "remoteshield-development", "--env-file", str(environment),
           "-f", str(repo / "docker/docker-compose.yml"), "-f", str(repo / "docker/compose.dev.yml")]
subprocess.run(compose + ["config", "--quiet"], check=True)
try:
    subprocess.run(compose + ["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90"], check=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for path in ("/ready", "/api/v1/meta", "/admin/"):
        with opener.open("http://127.0.0.1:18180" + path, timeout=5) as response:
            assert response.status == 200, path
        print(json.dumps({"check": "development edge " + path, "result": "PASS"}), flush=True)
    configuration = json.loads(subprocess.check_output(compose + ["config", "--format", "json"]))
    for service in configuration["services"].values():
        assert all(port["host_ip"] == "127.0.0.1" for port in service.get("ports", []))
    print(json.dumps({"result": "PASS", "checks": 4, "publishedPorts": "loopback only"}), flush=True)
except Exception:
    subprocess.run(compose + ["logs", "--no-color", "--tail", "15", "nginx"], check=False)
    raise
finally:
    subprocess.run(compose + ["down", "--volumes", "--timeout", "25"], check=True)
