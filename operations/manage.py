#!/usr/bin/env python3
"""Single-VPS Compose operations. Invoke with a private deployment directory."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
from urllib.parse import urlparse, urlunparse

REPOSITORY = Path(__file__).resolve().parents[1]
IMAGE = re.compile(r"^(?:sha256:[a-f0-9]{64}|[a-zA-Z0-9._:/-]+@sha256:[a-f0-9]{64})$")
RESTORE_NAME = re.compile(r"^rsx_restore_[a-z0-9_]{1,40}$")


class OperationError(Exception):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def atomic(path, value, mode=0o600):
    path = Path(path)
    temporary = path.with_name(path.name + ".tmp-" + secrets.token_hex(4))
    try:
        with temporary.open("x", encoding="utf8") as output:
            os.chmod(temporary, mode)
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def json_file(path, value, mode=0o600):
    atomic(path, json.dumps(value, indent=2) + "\n", mode)


def file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def execute(arguments, *, input_bytes=None):
    result = subprocess.run(arguments, cwd=REPOSITORY, input=input_bytes,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        # Caller can inspect service logs privately. Avoid emitting upstream secrets.
        raise OperationError(f"{Path(arguments[0]).name} failed with exit {result.returncode}")
    return result.stdout


def environment(root):
    path = root / "environment.env"
    if not path.is_file() or path.stat().st_size > 65536:
        raise OperationError("Deployment environment file unavailable")
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or "\x00" in value:
            raise OperationError("Use unquoted KEY=value deployment settings")
        values[key] = value
    if values.get("DEPLOYMENT_ENV") not in ("production", "staging"):
        raise OperationError("Choose production or staging")
    if Path(values.get("DEPLOYMENT_DIRECTORY", "")).resolve() != root:
        raise OperationError("Environment belongs to a different deployment directory")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", values.get("COMPOSE_PROJECT_NAME", "remoteshield-" + values["DEPLOYMENT_ENV"])):
        raise OperationError("Invalid Compose project name")
    return values


def compose(root, arguments):
    values = environment(root)
    files = [REPOSITORY / "docker/docker-compose.yml", REPOSITORY / "docker/compose.production.yml"]
    if values.get("SCIM_ENABLED") == "true":
        files.append(REPOSITORY / "docker/compose.scim.yml")
    command = ["docker", "compose", "--project-name", values.get("COMPOSE_PROJECT_NAME", "remoteshield-" + values["DEPLOYMENT_ENV"]),
               "--env-file", str(root / "environment.env")]
    for file in files:
        command.extend(["-f", str(file)])
    return command + arguments


def application_services(root):
    return ["backend", "nginx"] + (["scim-edge"] if environment(root).get("SCIM_ENABLED") == "true" else [])


@contextlib.contextmanager
def lock(root):
    with (root / ".maintenance.lock").open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def read_release(path):
    value = json.loads(Path(path).read_text())
    return validate_release(value)


def validate_release(value):
    if value.get("version") != 1 or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value.get("name", "")):
        raise OperationError("Invalid release manifest")
    if not all(IMAGE.fullmatch(value.get(key, "")) for key in ("backend", "edge")):
        raise OperationError("Release images must use immutable digest references")
    return {key: value[key] for key in ("version", "name", "backend", "edge")}


@contextlib.contextmanager
def release_environment(release):
    original = {key: os.environ.get(key) for key in ("BACKEND_IMAGE", "EDGE_IMAGE")}
    os.environ.update(BACKEND_IMAGE=release["backend"], EDGE_IMAGE=release["edge"])
    try:
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def event(root, action, **fields):
    record = {"event": "operations." + action, "at": now(), **fields}
    with (root / "events.jsonl").open("a") as output:
        output.write(json.dumps(record) + "\n")
    print(json.dumps(record), flush=True)


def active_database(root):
    value = urlparse((root / "secrets/db-owner-url").read_text().strip()).path.removeprefix("/")
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", value):
        raise OperationError("Unsupported database identifier")
    return value


def sql(root, database, statement):
    return execute(compose(root, ["exec", "-T", "--user", "postgres", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
                                  "-U", "remoteshield", "-d", database, "-At", "-c", statement])).decode().strip()


def schema_history(root, database):
    if not sql(root, database, "SELECT COALESCE(to_regclass('public.schema_migrations')::text,'')"):
        return []
    return json.loads(sql(root, database, "SELECT COALESCE(json_agg(x ORDER BY version),'[]') FROM (SELECT version,checksum FROM schema_migrations) x"))


def initialize(root, args):
    if root.exists() and any(root.iterdir()):
        raise OperationError("Initialization requires an empty deployment directory")
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", args.domain) or ".." in args.domain:
        raise OperationError("Invalid domain")
    if not re.fullmatch(r"age1[a-z0-9]{20,180}", args.recipient.strip()):
        raise OperationError("Initialization requires an age public recipient")
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    for directory in ("secrets", "certs", "backups", "releases", "status"):
        (root / directory).mkdir(mode=0o700 if directory != "status" else 0o755)
    # Secret files are individually mounted. Host parent directories restrict traversal.
    generated = {key: secrets.token_hex(32) for key in
                 ("db-owner-password", "db-runtime-password", "jwt-access", "jwt-refresh", "oidc-state", "metrics-token")}
    generated["db-owner-url"] = "postgresql://remoteshield:" + generated["db-owner-password"] + "@postgres:5432/remoteshield_db"
    generated["db-runtime-url"] = "postgresql://remoteshield_app:" + generated["db-runtime-password"] + "@postgres:5432/remoteshield_db"
    for key, value in generated.items():
        atomic(root / "secrets" / key, value + "\n", 0o444)
    template = (REPOSITORY / "docker/environments" / (args.environment + ".env.example")).read_text()
    template = re.sub(r"^DOMAIN=.*$", "DOMAIN=" + args.domain, template, flags=re.M)
    template = re.sub(r"^CORS_ORIGINS=.*$", "CORS_ORIGINS=https://" + args.domain + ",tauri://localhost,http://tauri.localhost,https://tauri.localhost", template, flags=re.M)
    template = re.sub(r"^DEPLOYMENT_DIRECTORY=.*$", "DEPLOYMENT_DIRECTORY=" + str(root), template, flags=re.M)
    atomic(root / "environment.env", template)
    atomic(root / "backup-recipient.txt", args.recipient.strip() + "\n")
    event(root, "initialized", environment=args.environment)


def backup(root):
    started = time.monotonic()
    database = active_database(root)
    recipient = (root / "backup-recipient.txt").read_text().strip()
    if not recipient.startswith("age1") or len(recipient) > 200:
        raise OperationError("Configure the independent age backup recipient")
    if not shutil.which("age"):
        raise OperationError("Install age before backing up")
    history = schema_history(root, database)
    name = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)
    target = root / "backups" / (name + ".dump.age")
    partial = target.with_suffix(target.suffix + ".partial")
    try:
        with partial.open("xb") as output:
            os.chmod(partial, 0o600)
            dump = subprocess.Popen(compose(root, ["exec", "-T", "--user", "postgres", "postgres", "pg_dump", "-U", "remoteshield", "-d", database,
                                                    "--format=custom", "--no-owner", "--no-acl"]), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            encrypt = subprocess.Popen(["age", "--encrypt", "--recipient", recipient], stdin=dump.stdout, stdout=output, stderr=subprocess.DEVNULL)
            dump.stdout.close()
            encrypted = encrypt.wait()
            dumped = dump.wait()
            if encrypted or dumped:
                raise OperationError("Database dump or encryption failed")
            output.flush()
            os.fsync(output.fileno())
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)
    receipt = {"version": 1, "file": target.name, "database": database, "completedAt": now(), "bytes": target.stat().st_size,
               "sha256": file_digest(target), "durationSeconds": time.monotonic() - started,
               "schema": history, "encrypted": True}
    json_file(target.with_suffix(target.suffix + ".json"), receipt)
    json_file(root / "status/backup.json", {key: receipt[key] for key in ("completedAt", "bytes", "durationSeconds", "encrypted")}, 0o444)
    event(root, "backup_complete", file=target.name, bytes=receipt["bytes"], seconds=receipt["durationSeconds"])
    return target


def backup_configuration(root):
    """Encrypt independent configuration; do not include archives or decryption keys."""
    recipient = (root / "backup-recipient.txt").read_text().strip()
    if not re.fullmatch(r"age1[a-z0-9]{20,180}", recipient) or not shutil.which("age"):
        raise OperationError("Install age and configure its backup recipient")
    names = ["environment.env", "backup-recipient.txt", "secrets", "certs", "releases"]
    names += [name for name in ("current.json", "previous.json") if (root / name).exists()]
    target = root / "backups" / ("configuration-" + secrets.token_hex(8) + ".tar.age")
    partial = target.with_suffix(".partial")
    try:
        with partial.open("xb") as output:
            os.chmod(partial, 0o600)
            archive = subprocess.Popen(["tar", "-C", str(root), "-cf", "-", *names], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            encrypt = subprocess.Popen(["age", "--encrypt", "--recipient", recipient], stdin=archive.stdout, stdout=output, stderr=subprocess.DEVNULL)
            archive.stdout.close()
            encrypted, archived = encrypt.wait(), archive.wait()
            if encrypted or archived:
                raise OperationError("Configuration archive or encryption failed")
            output.flush()
            os.fsync(output.fileno())
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)
    json_file(target.with_suffix(target.suffix + ".json"), {"version": 1, "kind": "configuration", "completedAt": now(), "sha256": file_digest(target)})
    event(root, "configuration_backup_complete", file=target.name)
    return target


def restore(root, archive, identity, database):
    if not RESTORE_NAME.fullmatch(database):
        raise OperationError("Restore target must be a new rsx_restore_ database")
    archive = Path(archive).resolve()
    receipt = json.loads(archive.with_suffix(archive.suffix + ".json").read_text())
    if receipt.get("version") != 1 or file_digest(archive) != receipt.get("sha256"):
        raise OperationError("Backup integrity verification failed")
    exists = sql(root, "postgres", "SELECT 1 FROM pg_database WHERE datname='" + database + "'")
    if exists:
        raise OperationError("Restore refuses an existing target database")
    execute(compose(root, ["exec", "-T", "--user", "postgres", "postgres", "createdb", "-U", "remoteshield", "--template=template0", database]))
    try:
        decrypt = subprocess.Popen(["age", "--decrypt", "--identity", str(Path(identity).resolve()), str(archive)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        restored = subprocess.Popen(compose(root, ["exec", "-T", "--user", "postgres", "postgres", "pg_restore", "-U", "remoteshield", "-d", database,
                                                   "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"]), stdin=decrypt.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        decrypt.stdout.close()
        restored_code = restored.wait()
        decrypted_code = decrypt.wait()
        if restored_code or decrypted_code:
            raise OperationError("Backup decryption or database restoration failed")
        if schema_history(root, database) != receipt["schema"]:
            raise OperationError("Restored migration history differs from backup")
    except Exception:
        execute(compose(root, ["exec", "-T", "--user", "postgres", "postgres", "dropdb", "-U", "remoteshield", database]))
        raise
    json_file(root / "releases" / (database + ".json"), {"version": 1, "database": database, "backup": archive.name, "verifiedAt": now(), "schema": receipt["schema"]})
    event(root, "restore_verified", database=database)


def select_images(root, release):
    for image in (release["backend"], release["edge"]):
        try:
            execute(["docker", "image", "inspect", image])
        except OperationError:
            execute(["docker", "pull", image])
    execute(compose(root, ["config", "--quiet"]))


def deploy(root, manifest, rollback=False):
    release = read_release(manifest)
    with release_environment(release):
        select_images(root, release)
        if rollback:
            execute(compose(root, ["run", "--rm", "--no-deps", "backend", "node", "src/check-database.js"]))
        else:
            execute(compose(root, ["up", "-d", "--no-build", "--wait", "--wait-timeout", "90", "postgres"]))
        services=application_services(root)
        execute(compose(root, ["stop", "-t", "25", *services]))
        try:
            if not rollback:
                backup(root)
                execute(compose(root, ["run", "--rm", "--no-deps", "migrate"]))
            execute(compose(root, ["up", "-d", "--no-build", "--no-deps", "--force-recreate", "--wait", "--wait-timeout", "90", *services]))
        except Exception:
            event(root, "deployment_failed", release=release["name"])
            raise
    current = root / "current.json"
    if current.exists():
        atomic(root / "previous.json", current.read_text())
    json_file(current, release)
    json_file(root / "releases" / (release["name"] + ".json"), release)
    event(root, "rollback_complete" if rollback else "deployment_complete", release=release["name"])


def activate_restore(root, database):
    if not RESTORE_NAME.fullmatch(database):
        raise OperationError("A verified restored target is required")
    evidence = root / "releases" / (database + ".json")
    if not evidence.is_file() or json.loads(evidence.read_text())["schema"] != schema_history(root, database):
        raise OperationError("Restore evidence is unavailable or differs from database")
    release = read_release(root / "current.json")
    with release_environment(release):
        services=application_services(root)
        execute(compose(root, ["stop", "-t", "25", *services]))
        for name in ("db-owner-url", "db-runtime-url"):
            path = root / "secrets" / name
            parsed = urlparse(path.read_text().strip())
            atomic(path, urlunparse(parsed._replace(path="/" + database)) + "\n", 0o444)
        execute(compose(root, ["run", "--rm", "--no-deps", "migrate"]))
        execute(compose(root, ["run", "--rm", "--no-deps", "-e", "RECOVERY_DATABASE=" + database, "migrate", "node", "src/db/recover.js"]))
        execute(compose(root, ["up", "-d", "--no-deps", "--no-build", "--force-recreate", "--wait", "--wait-timeout", "90", *services]))
    event(root, "restore_activated", database=database)


def observe(root):
    release = read_release(root / "current.json")
    findings = []
    with release_environment(release):
        for service in ["postgres", *application_services(root)]:
            identifiers = execute(compose(root, ["ps", "-aq", service])).decode().split()
            state = json.loads(execute(["docker", "inspect", identifiers[0]]))[0]["State"] if identifiers else {}
            healthy = state.get("Running") and state.get("Health", {}).get("Status") == "healthy"
            if not healthy:
                findings.append({"key": service + "_unhealthy", "message": service + " container is unavailable or unhealthy", "severity": "critical"})
    values = environment(root)
    backup_file = root / "status/backup.json"
    age = time.time() - backup_file.stat().st_mtime if backup_file.exists() else float("inf")
    if age > int(values.get("BACKUP_MAX_AGE_SECONDS", "90000")):
        findings.append({"key": "backup_stale", "message": "A successful backup is overdue", "severity": "high"})
    cert = root / "certs/tls.crt"
    if not cert.is_file() or subprocess.run(["openssl", "x509", "-checkend", "604800", "-noout", "-in", str(cert)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        findings.append({"key": "tls_expiry", "message": "TLS certificate is unavailable or expires within seven days", "severity": "high"})
    disk = shutil.disk_usage(root)
    if disk.used / disk.total > 0.85:
        findings.append({"key": "disk_pressure", "message": "Deployment filesystem exceeds 85 percent capacity", "severity": "high"})
    target = root / "status/alerts.json"
    old = json.loads(target.read_text()).get("alerts", []) if target.exists() else []
    previous = {item["key"]: item for item in old}
    active = {item["key"]: item for item in findings}
    alerts = []
    for key in sorted(set(previous) | set(active)):
        state = "firing" if key in active else "resolved"
        item = {**(active.get(key) or previous[key]), "state": state}
        if previous.get(key, {}).get("state") != state:
            item["changedAt"] = now()
            event(root, "alert_transition", key=key, state=state, severity=item["severity"])
        else:
            item["changedAt"] = previous[key]["changedAt"]
        alerts.append(item)
    json_file(target, {"observedAt": now(), "alerts": alerts}, 0o444)
    return bool(findings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["init", "deploy", "rollback", "backup", "backup-config", "restore", "activate-restore", "observe", "compose", "manifest"])
    parser.add_argument("directory", type=Path)
    parser.add_argument("--environment", choices=["staging", "production"], default="production")
    parser.add_argument("--domain")
    parser.add_argument("--recipient")
    parser.add_argument("--release")
    parser.add_argument("--archive")
    parser.add_argument("--identity")
    parser.add_argument("--database")
    parser.add_argument("--name")
    parser.add_argument("--backend")
    parser.add_argument("--edge")
    args, remainder = parser.parse_known_args()
    if remainder and args.action != "compose":
        parser.error("Unrecognized arguments")
    root = args.directory.resolve()
    if args.action == "manifest":
        release = {"version": 1, "name": args.name, "backend": args.backend, "edge": args.edge}
        if not args.release:
            raise OperationError("Manifest output is required")
        validate_release(release)
        json_file(args.release, release)
        return
    if args.action == "init":
        if not args.domain or not args.recipient:
            raise OperationError("Initialization requires domain and age recipient")
        initialize(root, args)
        return
    environment(root)
    if args.action == "compose":
        release = read_release(args.release or root / "current.json")
        with release_environment(release):
            subprocess.run(compose(root, remainder[1:] if remainder[:1] == ["--"] else remainder), check=True)
        return
    with lock(root):
        if args.action in ("deploy", "rollback"):
            deploy(root, args.release or root / "previous.json", args.action == "rollback")
        elif args.action == "backup":
            backup(root)
        elif args.action == "backup-config":
            backup_configuration(root)
        elif args.action == "restore":
            restore(root, args.archive, args.identity, args.database)
        elif args.action == "activate-restore":
            activate_restore(root, args.database)
        elif args.action == "observe":
            observe(root)


if __name__ == "__main__":
    try:
        main()
    except (OperationError, OSError, ValueError, TypeError, subprocess.SubprocessError) as error:
        print(json.dumps({"event": "operations.failed", "type": type(error).__name__, "message": str(error) if isinstance(error, OperationError) else "Inspect private deployment state and arguments"}), file=sys.stderr)
        sys.exit(1)
