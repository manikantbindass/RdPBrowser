#!/usr/bin/env python3
"""Manage a dedicated WireGuard gateway using device-generated public keys."""

import argparse
import base64
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import uuid

V4 = ipaddress.ip_network("10.8.0.0/24")
V6 = ipaddress.ip_network("fd42:5253:5800::/64")
INTERFACE = "wg0"
PORT = 51820


def wg(*args, data=None):
    result = subprocess.run(["wg", *args], input=data, text=True, capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError(f"WireGuard {args[0]} failed. Inspect the interface from the gateway console.")
    return result.stdout


def key(value):
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        raise ValueError("Expected a canonical WireGuard public key") from None
    if len(raw) != 32 or not any(raw) or base64.b64encode(raw).decode() != value:
        raise ValueError("Expected a canonical WireGuard public key")
    return value


def public_key_argument(value):
    try:
        return key(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Expected a WireGuard public key") from None


def device_id_argument(value):
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise argparse.ArgumentTypeError("Expected a device registry UUID") from None


def write_private(path, content):
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        parent = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def private_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd) as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError(f"{path.name} must be a private, operator-owned file")
        return file.read()


def validate_registry(registry):
    ipaddress.IPv4Address(registry["endpoint"])
    ids, slots, keys = set(), set(), set()
    for peer in registry["peers"]:
        identity = str(uuid.UUID(peer["deviceId"]))
        slot = peer["slot"]
        public_key = key(peer["publicKey"])
        if (identity != peer["deviceId"] or identity in ids or type(slot) is not int
                or not 2 <= slot <= 254 or slot in slots or public_key in keys
                or type(peer["active"]) is not bool):
            raise ValueError("Invalid or duplicate device, address or key in registry")
        ids.add(identity)
        slots.add(slot)
        keys.add(public_key)
    retired = [key(value) for value in registry["retiredKeys"]]
    if keys.intersection(retired) or len(set(retired)) != len(retired):
        raise ValueError("Duplicate or reused retired public key")


def peer_addresses(peer):
    return f"{V4[peer['slot']]}/32", f"{V6[peer['slot']]}/128"


def sync(directory, registry, server_key):
    # Configuration is applied in one syncconf operation. Temporary key material
    # is mode 0600 and never passed in argv or printed.
    config = f"[Interface]\nPrivateKey = {server_key}\nListenPort = {PORT}\n"
    for peer in registry["peers"]:
        if peer["active"]:
            config += f"\n[Peer]\nPublicKey = {peer['publicKey']}\nAllowedIPs = {', '.join(peer_addresses(peer))}\n"
    fd, name = tempfile.mkstemp(dir=directory)
    try:
        with os.fdopen(fd, "w") as file:
            file.write(config)
        wg("syncconf", INTERFACE, name)
    except (RuntimeError, OSError, subprocess.SubprocessError):
        # A failed reconciliation must not leave a revoked peer on a live link.
        try:
            subprocess.run(["ip", "link", "set", INTERFACE, "down"], check=True, timeout=10, capture_output=True)
        except (OSError, subprocess.SubprocessError):
            raise RuntimeError("Reconciliation and link shutdown failed. Isolate the gateway immediately.") from None
        raise RuntimeError("Reconciliation failed. The gateway link was disabled. Run sync before bringing it up.") from None
    finally:
        Path(name).unlink(missing_ok=True)


def run(args, directory):
    state = directory / "peers.json"
    server_path = directory / "server.key"
    if args.command == "init":
        if state.exists() or server_path.exists():
            raise ValueError("State already exists. Use the recovery procedure for a partial initialization.")
        endpoint = str(ipaddress.IPv4Address(args.endpoint))
        write_private(server_path, wg("genkey"))
        write_private(state, json.dumps({"endpoint": endpoint,
                                        "peers": [], "retiredKeys": []}) + "\n")
        return
    registry = json.loads(private_read(state))
    validate_registry(registry)
    server_key = private_read(server_path).strip()
    server_public = key(wg("pubkey", data=server_key + "\n").strip())
    peers = {item["deviceId"]: item for item in registry["peers"]}
    if args.command == "sync":
        sync(directory, registry, server_key)
        return
    if args.command == "status":
        handshakes = dict(line.split() for line in wg("show", INTERFACE, "latest-handshakes").splitlines())
        now = int(time.time())
        expected = {item["publicKey"] for item in peers.values() if item["active"]}
        print(json.dumps({"interface": INTERFACE, "registryMatchesLive": expected == set(handshakes), "peers": [
            {"deviceId": item["deviceId"], "addresses": peer_addresses(item), "active": item["active"],
             "configured": item["publicKey"] in handshakes,
             "handshakeAgeSeconds": max(0, now - int(timestamp)) if timestamp != "0" else None}
            for item in peers.values() for timestamp in [handshakes.get(item["publicKey"], "0")]
        ]}, indent=2))
        return
    peer = peers.get(args.device)
    if args.command == "profile":
        if not peer or not peer["active"]:
            raise ValueError("Device is unavailable")
        linux = "FwMark = 0x525358\nTable = off\n" if args.linux else ""
        print("[Interface]\nPrivateKey = <INSERT DEVICE PRIVATE KEY LOCALLY>\n"
              f"Address = {', '.join(peer_addresses(peer))}\nDNS = {V4[1]}, {V6[1]}\n{linux}"
              f"\n[Peer]\nPublicKey = {server_public}\nEndpoint = {registry['endpoint']}:{PORT}\n"
              "AllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25")
        return
    if args.command == "add" and peer:
        raise ValueError("Device ID already exists. Use rotate to replace its key.")
    if args.command != "add" and (not peer or not peer["active"]):
        raise ValueError("Device is unavailable")
    if args.command != "revoke":
        public_key = args.public_key
        if public_key == server_public or public_key in registry["retiredKeys"] or any(
                item["publicKey"] == public_key for item in peers.values()):
            raise ValueError("Public key already used or retired")
    if args.command == "add":
        used = {item["slot"] for item in peers.values()}
        slot = next((candidate for candidate in range(2, 255) if candidate not in used), None)
        if slot is None:
            raise ValueError("Address pool exhausted. Migrate to a new gateway or pool.")
        registry["peers"].append({"deviceId": args.device, "slot": slot, "publicKey": public_key, "active": True})
    elif args.command == "rotate":
        registry["retiredKeys"].append(peer["publicKey"])
        peer["publicKey"] = public_key
    else:
        peer["active"] = False
    write_private(state, json.dumps(registry, indent=2) + "\n")
    sync(directory, registry, server_key)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=Path("/etc/remoteshield/wireguard"))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init").add_argument("endpoint", type=ipaddress.IPv4Address)
    for name in ("add", "rotate", "revoke", "profile"):
        command = commands.add_parser(name)
        command.add_argument("device", type=device_id_argument)
        if name in ("add", "rotate"):
            command.add_argument("public_key", type=public_key_argument)
        if name == "profile":
            command.add_argument("--linux", action="store_true")
    commands.add_parser("status")
    commands.add_parser("sync")
    args = parser.parse_args()
    try:
        directory = args.state_dir
        os.umask(0o077)
        directory.mkdir(mode=0o700, exist_ok=True, parents=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError("State directory must be private and operator-owned")
        with os.fdopen(os.open(directory / ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), "r+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            run(args, directory)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError, argparse.ArgumentTypeError,
            subprocess.SubprocessError) as error:
        # Parser/registry errors can contain file contents. Print only messages we own.
        safe = str(error) if type(error) is RuntimeError or type(error) is ValueError and not isinstance(
            error, (json.JSONDecodeError, ipaddress.AddressValueError)) else "WireGuard state or operation unavailable"
        print(safe, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
