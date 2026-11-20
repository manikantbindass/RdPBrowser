# Deployment

The supported reference is a single Linux VPS with Docker Compose, PostgreSQL and Nginx, plus a stateful Linux WireGuard gateway. Use separate hosts or isolated namespaces for staging and production. The default Compose control subnet and tunnel bind can collide if both share a daemon. See the [network protection model](SECURITY_MODEL.md#network-and-navigation) and [recovery evidence](PHASE14_REPORT.md).

## Plan the perimeter and capacity

Start with the previously documented sizing assumption of 2 vCPUs, 4 GiB RAM and 80 GiB of disk. Treat it as an initial budget. Measure actual connection counts, database growth, gateway throughput, file retention and recovery time. The isolated smoke tests use a small data set. Stateless API scaling needs a measured workload and a reviewed Socket.IO coordination design. The WireGuard gateway, peer registry, PostgreSQL and restore process have separate state and availability requirements.

- The default control edge binds HTTPS to the WireGuard IPv4 address, with Nginx as UID 101 and backend as UID 1001. The PostgreSQL network stays private.
- Use a trusted full-chain certificate and internal DNS for the control hostname. Maintain separate operator SSH access and an off-host recovery channel. Add the optional SCIM TLS listener only for approved provisioner sources.
- Restrict administrator and provisioner CIDRs. Review the host and cloud firewall together. The DigitalOcean Terraform profile now requires explicit client source CIDRs for WireGuard and explicit destination CIDRs for web and DNS egress. It allows TCP 80 and 443 to approved web networks, TCP and UDP 53 to approved resolvers, and optional UDP 123 to approved time servers. The provider firewall denies other traffic by default. [DigitalOcean firewall rules](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/)

Before applying the Terraform change to an existing gateway, inventory client source networks, approved destinations, image registries, OS package mirrors, the identity provider, ACME endpoints, resolver upstreams, and any time servers. The reference Unbound configuration performs recursion, which contacts DNS servers across the Internet. For this allowlisted cloud profile, configure forwarding to the approved upstream resolvers. Verify intended paths in staging, including IPv6 and path MTU. This cloud profile assumes clients connect from known networks and browse destinations within the configured allowlist. Terraform tests use mock plans. [Terraform inputs](../infrastructure/digitalocean/terraform.tfvars.example)

## Initial setup

Provision the approved WireGuard gateway, resolver, peer allocation and firewall first. Use the [network controls](SECURITY_MODEL.md#network-and-navigation) for new and existing gateways. Verify IPv4, IPv6, DNS, failure and revocation on the intended managed clients before opening tenant access.

Create the deployment directory with an operator-supplied domain and a public `age` recipient. The matching recovery key stays on a separate recovery workstation. The following example is for an isolated staging host.

```sh
sudo python3 operations/manage.py init /opt/remoteshield-staging \
  --domain "$CONTROL_DOMAIN" --environment staging --recipient "$AGE_PUBLIC_RECIPIENT"
```

Install the trusted certificate files using the private directory and mount permissions from [architecture](ARCHITECTURE.md). Review `environment.env`, scope secret files to each service, and keep migration credentials in the one-shot job. Review TLS trust for a remote PostgreSQL server and avoid reusing the previous owner's credentials in the backend. Existing deployments must preserve their actual Compose project and volume names. [migration and release evidence](PHASE14_REPORT.md)

## Deploy and observe

Obtain a reviewed immutable deployment manifest containing backend and edge image IDs or registry digests. Verify release hashes and provenance first. Use the deployment CLI to generate a manifest from the reviewed images as described in [architecture](ARCHITECTURE.md). In the example, `REVIEWED_MANIFEST` points to that local file.

```sh
sudo python3 operations/manage.py deploy /opt/remoteshield-staging --release "$REVIEWED_MANIFEST"
sudo python3 operations/manage.py observe /opt/remoteshield-staging
```

Deployment checks effective configuration, protects the database with an encrypted backup, runs migrations and waits for ready services. Confirm the TLS chain, expected revision, tenant sign-in and source admission from a managed endpoint. Monitor private readiness and authenticated metrics. Alert owners should verify notifications and off-host backup freshness in the actual operating environment.

## Roll back and recover

Keep the last compatible image pair and verified backups. The rollback command uses the previous manifest unless explicitly given a reviewed alternative.

```sh
sudo python3 operations/manage.py rollback /opt/remoteshield-staging
```

The tool checks schema compatibility before reactivation. An incompatible schema requires the separate fresh-target restore and activation process. Restore activation invalidates stale sessions and provisioning credentials and requires operator reconciliation of user access, directories and VPN peers. Confirm backup retention, recovery point and recovery time through a replacement-host exercise. [disaster recovery acceptance](ROADMAP.md#release-gates) · [Release process](RELEASE_PROCESS.md)
