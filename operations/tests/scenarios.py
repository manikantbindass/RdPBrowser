"""Destructive tests restricted to lab.sh's disposable network namespace and database."""
import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("operations", Path(__file__).parents[1] / "manage.py")
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
work = Path(sys.argv[1])
if (not os.environ.get("RSX_OPERATIONS_PARENT") or os.readlink("/proc/self/ns/net") == os.environ["RSX_OPERATIONS_PARENT"]
        or not str(work).startswith("/tmp/tmp.") or os.environ.get("DOCKER_HOST") != "unix://" + str(work / "docker.sock")):
    raise RuntimeError("Run only through lab.sh inside its private namespaces")
root = work / "deployment"
checks = []


def check(condition, name):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print(json.dumps({"check": name, "result": "PASS"}), flush=True)


def expect_failure(callback, name):
    try:
        callback()
    except M.OperationError:
        check(True, name)
        return
    raise AssertionError(name + " unexpectedly succeeded")


def command(*args):
    return M.execute(list(args)).decode().strip()


def compose(*args, input_bytes=None):
    return M.execute(M.compose(root, list(args)), input_bytes=input_bytes)


def container(service):
    return compose("ps", "-aq", service).decode().strip()


def state(service):
    return json.loads(command("docker", "inspect", container(service)))[0]


def wait(callback, seconds=90):
    start = time.monotonic()
    while time.monotonic() - start < seconds:
        try:
            if callback():
                return time.monotonic() - start
        except (OSError, ValueError, M.OperationError):
            pass
        time.sleep(0.5)
    raise AssertionError("Timed out waiting for service recovery")


context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.check_hostname = True
# Trust this fixture certificate explicitly; never disable verification.
opener = None


def http(path, body=None, token=None, operations=False):
    base = "http://127.0.0.1:9092" if operations else "https://10.8.0.1"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with opener.open(request, timeout=12) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers


def ready():
    return http("/ready")[0] == 200


identity = work / "backup-identity"
subprocess.run(["age-keygen", "-o", str(identity)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
recipient = command("age-keygen", "-y", str(identity))
M.initialize(root, type("Args", (), {"environment": "staging", "domain": "phase12.test", "recipient": recipient})())
with (root / "environment.env").open("a") as output:
    output.write("\nRATE_LIMIT_MAX=10000\nTRACE_SAMPLE_RATE=1\n")
command("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-subj", "/CN=phase12.test",
        "-addext", "subjectAltName=IP:10.8.0.1,DNS:phase12.test", "-keyout", str(root / "certs/tls.key"), "-out", str(root / "certs/tls.crt"))
for file in (root / "certs").iterdir():
    file.chmod(0o444)
context.load_verify_locations(str(root / "certs/tls.crt"))
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
releases = []
for name in ("a", "b"):
    release = {"version": 1, "name": "phase12-" + name,
               "backend": command("docker", "image", "inspect", "remoteshield-backend:phase12-" + name, "--format", "{{.Id}}"),
               "edge": command("docker", "image", "inspect", "remoteshield-nginx:phase12", "--format", "{{.Id}}")}
    path = work / (name + ".json")
    M.json_file(path, release)
    releases.append(path)
M.deploy(root, releases[0])
with M.release_environment(M.read_release(releases[0])):
    check(ready(), "production override deploys healthy containers with file secrets")
    for service, user in (("backend", "remoteshield"), ("nginx", "101:101")):
        info = state(service)
        check(info["Config"]["User"] == user and info["HostConfig"]["ReadonlyRootfs"] and info["HostConfig"]["CapDrop"] == ["ALL"], service + " runs non-root with read-only root and dropped capabilities")
    environment = state("backend")["Config"]["Env"]
    secret_values = [path.read_text().strip() for path in (root / "secrets").iterdir()]
    check(not any(secret in item for secret in secret_values for item in environment), "container environment contains secret paths without secret values")
    metrics_token = (root / "secrets/metrics-token").read_text().strip()
    check(http("/metrics", operations=True)[0] == 401, "internal metrics rejects unauthenticated requests")
    M.observe(root)
    check(http("/status", token=metrics_token, operations=True)[0] == 200, "authenticated operational dashboard reads real telemetry")
    org = "00000000-0000-4000-8000-000000000001"
    admin = "00000000-0000-4000-8000-000000001201"
    # This published password belongs only to the isolated test fixture.
    M.sql(root, "remoteshield_db", "INSERT INTO users(id,organization_id,username,email,password_hash,role) VALUES ('" + admin + "','" + org + "','labadmin','labadmin@test.example',crypt('FixturePassword12!',gen_salt('bf')),'superadmin')")
    M.sql(root, "remoteshield_db", "INSERT INTO blocked_urls(organization_id,pattern,reason) VALUES ('" + org + "','blocked.test','restore-fixture')")
    status, payload, _ = http("/api/v1/auth/login", {"username": "labadmin", "password": "FixturePassword12!", "organizationId": org})
    check(status == 200, "real password authentication works through hardened TLS edge")
    token = json.loads(payload)["accessToken"]
    check(http("/api/v1/organization", token=token)[0] == 200, "tenant API works before recovery")
    M.sql(root, "remoteshield_db", "INSERT INTO directory_connections(id,organization_id,name) VALUES ('00000000-0000-4000-8000-000000001202','" + org + "','recovery fixture'); INSERT INTO provisioning_credentials(organization_id,directory_id,token_hash,created_by,expires_at) VALUES ('" + org + "','00000000-0000-4000-8000-000000001202',repeat('a',64),'" + admin + "',NOW()+INTERVAL '1 day'); INSERT INTO oidc_settings(organization_id,provider_id,enabled) VALUES ('" + org + "','fixture',TRUE); INSERT INTO devices(organization_id,user_id,external_id,name,platform,trust_state) VALUES ('" + org + "','" + admin + "','fixture-device','Recovery fixture','linux','approved')")
    M.sql(root, "remoteshield_db", "INSERT INTO organizations(id,name) VALUES ('00000000-0000-4000-8000-000000001203','Second recovery tenant'); INSERT INTO users(organization_id,username,email,password_hash) VALUES ('00000000-0000-4000-8000-000000001203','seconduser','second@test.example','fixture-not-a-password-hash')")
    archive = M.backup(root)
    config_archive = M.backup_configuration(root)
    config_data = M.execute(["age", "--decrypt", "--identity", str(identity), str(config_archive)])
    with tarfile.open(fileobj=io.BytesIO(config_data)) as contents:
        check("secrets/jwt-access" in contents.getnames() and not any("identity" in item or "backups/" in item for item in contents.getnames()), "configuration backup encrypts secrets and excludes archives and recovery identity")
    check(archive.stat().st_mode & 0o777 == 0o600 and not list((root / "backups").glob("*.partial")), "backup leaves only private encrypted files and receipts")
    check(M.sql(root, "remoteshield_db", "SELECT count(*) FROM sessions WHERE is_active") == "1", "backup fixture contains an active session")
    started = time.monotonic()
    M.restore(root, archive, identity, "rsx_restore_lab")
    restore_seconds = time.monotonic() - started
    check(M.sql(root, "rsx_restore_lab", "SELECT count(*) FROM blocked_urls WHERE reason='restore-fixture'") == "1", "custom-format backup restores actual policy data")
    expect_failure(lambda: M.restore(root, archive, identity, "rsx_restore_lab"), "restore refuses existing target database")
    bad_identity = work / "wrong-identity"
    subprocess.run(["age-keygen", "-o", str(bad_identity)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    expect_failure(lambda: M.restore(root, archive, bad_identity, "rsx_restore_wrongkey"), "incorrect recovery key fails closed")
    check(M.sql(root, "postgres", "SELECT count(*) FROM pg_database WHERE datname='rsx_restore_wrongkey'") == "0", "failed restore removes only its newly created database")
    corrupt = work / "corrupt.dump.age"
    corrupt.write_bytes(archive.read_bytes() + b"corrupt")
    M.json_file(corrupt.with_suffix(corrupt.suffix + ".json"), json.loads(archive.with_suffix(archive.suffix + ".json").read_text()))
    expect_failure(lambda: M.restore(root, corrupt, identity, "rsx_restore_corrupt"), "corrupted archive fails integrity check before database creation")
    # Exercise outage response while the test database's durable volume remains intact.
    command("docker", "stop", "-t", "10", container("postgres"))
    check(http("/ready")[0] == 503 and http("/health")[0] == 200, "database outage fails readiness while process liveness remains available")
    M.observe(root)
    check(any(alert["key"] == "postgres_unhealthy" and alert["state"] == "firing" for alert in json.loads((root / "status/alerts.json").read_text())["alerts"]), "observer records database failure alert")
    command("docker", "start", container("postgres"))
    database_recovery_seconds = wait(ready)
    wait(lambda: state("postgres")["State"]["Health"]["Status"] == "healthy")
    M.observe(root)
    check(any(alert["key"] == "postgres_unhealthy" and alert["state"] == "resolved" for alert in json.loads((root / "status/alerts.json").read_text())["alerts"]), "observer records recovered database alert transition")
    # A Docker API kill is treated as an operator stop and suppresses restart policy.
    # Crash the application process inside the fixture instead.
    command("docker", "exec", container("backend"), "sh", "-c", "kill -KILL $(pidof node)")
    crash_recovery_seconds = wait(lambda: state("backend")["RestartCount"] > 0 and ready())
    check(True, "backend crash restarts and restores API availability")
    edge_id = container("nginx")
    backend_info = state("backend")
    network = next(name for name in backend_info["NetworkSettings"]["Networks"] if name.endswith("_control"))
    old_ip = backend_info["NetworkSettings"]["Networks"][network]["IPAddress"]
    compose("stop", "-t", "25", "backend")
    compose("rm", "-f", "backend")
    command("docker", "run", "-d", "--name", "occupy-old-address", "--network", network, "--ip", old_ip, "--entrypoint", "sleep", M.read_release(releases[0])["edge"], "120")
    compose("up", "-d", "--no-deps", "--no-build", "--wait", "backend")
    dns_recovery_seconds = wait(ready)
    check(container("nginx") == edge_id and state("backend")["NetworkSettings"]["Networks"][network]["IPAddress"] != old_ip, "edge resolves changed backend address without edge restart")
    command("docker", "rm", "-f", "occupy-old-address")
M.deploy(root, releases[1])
M.deploy(root, releases[0], rollback=True)
with M.release_environment(M.read_release(releases[0])):
    check(json.loads(http("/status", token=metrics_token, operations=True)[1])["revision"] == "phase12-a", "artifact rollback returns to previous executable revision")
    check(M.sql(root, "remoteshield_db", "SELECT count(*) FROM blocked_urls WHERE reason='restore-fixture'") == "1", "deployment and rollback preserve database records")
    M.sql(root, "remoteshield_db", "INSERT INTO schema_migrations(version,checksum) VALUES ('999_incompatible.sql','fixture')")
    backend_id = container("backend")
    expect_failure(lambda: M.deploy(root, releases[1], rollback=True), "incompatible schema prevents rollback before stopping services")
    check(container("backend") == backend_id, "failed rollback preflight preserves running container")
    M.sql(root, "remoteshield_db", "DELETE FROM schema_migrations WHERE version='999_incompatible.sql'")
    wait(ready)
    started = time.monotonic()
    M.activate_restore(root, "rsx_restore_lab")
    activation_seconds = time.monotonic() - started
    check(http("/api/v1/organization", token=token)[0] == 401, "restored access token cannot reactivate old session")
    check(http("/api/v1/auth/login", {"username": "labadmin", "password": "FixturePassword12!", "organizationId": org})[0] == 403, "restored users remain locked pending identity reconciliation")
    check(M.sql(root, "rsx_restore_lab", "SELECT count(*) FROM sessions WHERE is_active OR refresh_hash IS NOT NULL") == "0", "recovery invalidates access and refresh sessions")
    check(M.sql(root, "rsx_restore_lab", "SELECT count(*) FROM users WHERE NOT is_locked") == "0", "recovery locks identities across both fixture tenants")
    check(M.sql(root, "rsx_restore_lab", "SELECT (SELECT count(*) FROM provisioning_credentials WHERE revoked_at IS NULL)+(SELECT count(*) FROM directory_connections WHERE is_active)+(SELECT count(*) FROM oidc_settings WHERE enabled)+(SELECT count(*) FROM devices WHERE status<>'revoked' OR trust_state<>'revoked')") == "0", "recovery disables restored SSO, directory credentials and device trust")
    compose("run", "--rm", "--no-deps", "-T", "migrate", "node", "src/db/recover.js", "unlock", admin, org, input_bytes=b"NewFixturePassword12!\n")
    status, payload, _ = http("/api/v1/auth/login", {"username": "labadmin", "password": "NewFixturePassword12!", "organizationId": org})
    check(status == 200, "operator recovery resets and unlocks a local superadmin")
    token = json.loads(payload)["accessToken"]
    check(http("/api/v1/organization", token=token)[0] == 200, "recovered database serves authorized tenant requests")
    # Bounded smoke load; this is not a cloud capacity guarantee.
    def timed_request(_):
        started = time.monotonic()
        code = http("/api/v1/organization", token=token)[0]
        return code, (time.monotonic() - started) * 1000
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(timed_request, range(300)))
    elapsed = time.monotonic() - started
    values = sorted(item[1] for item in results)
    check(all(code == 200 for code, _ in results), "300 authenticated TLS API requests at concurrency ten succeed")
    logs = compose("logs", "--no-color", "backend").decode()
    check(not any(secret in logs for secret in secret_values) and token not in logs and 'NewFixturePassword12!' not in logs, "application logs contain no fixture credentials or access token")
    check('trace.span' in logs and 'db.query' in logs, "sampled request and database spans are emitted")
    M.observe(root)
    performance = {"requests": len(results), "concurrency": 10, "seconds": elapsed, "requestsPerSecond": len(results) / elapsed,
                   "latencyMs": {"p50": values[149], "p95": values[284], "p99": values[296]}, "errors": sum(code != 200 for code, _ in results),
                   "restoreSeconds": restore_seconds, "activationSeconds": activation_seconds, "databaseRecoverySeconds": database_recovery_seconds,
                   "backendCrashRecoverySeconds": crash_recovery_seconds, "dnsRecoverySeconds": dns_recovery_seconds,
                   "backendMemoryLimitBytes": state("backend")["HostConfig"]["Memory"], "host": os.uname().release}
    print(json.dumps({"performance": performance}), flush=True)
    compose("down", "--volumes", "--timeout", "25")
print(json.dumps({"result": "PASS", "checks": len(checks), "hostNetworkModified": False, "cloudResourcesCreated": False}), flush=True)
