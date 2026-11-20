mock_provider "digitalocean" {}

run "reject_noncanonical_ssh_wildcard" {
  command = plan
  variables {
    admin_cidrs = ["198.51.100.1/0"]
  }
  expect_failures = [var.admin_cidrs]
}

variables {
  ssh_key_fingerprints  = ["mock-key"]
  admin_public_key      = "ssh-ed25519 AAAATESTONLY operator-fixture"
  admin_cidrs           = ["203.0.113.10/32"]
  vpn_client_cidrs      = ["198.51.100.0/24", "2001:db8:10::/48"]
  web_egress_cidrs      = ["192.0.2.0/25", "2001:db8:20::/48"]
  resolver_egress_cidrs = ["192.0.2.53/32"]
}

run "single_vps_defaults" {
  command = plan
  assert {
    condition     = digitalocean_droplet.remoteshield.size == "s-2vcpu-4gb"
    error_message = "The reference topology should use one documented VPS size."
  }
  assert {
    condition     = length(digitalocean_firewall.remoteshield.inbound_rule) == 2
    error_message = "Default ingress should contain scoped SSH and WireGuard only."
  }
  assert {
    condition     = toset([for rule in digitalocean_firewall.remoteshield.outbound_rule : "${rule.protocol}/${rule.port_range}"]) == toset(["tcp/80", "tcp/443", "tcp/53", "udp/53"])
    error_message = "Default egress should allow only web and DNS on their explicitly scoped ports."
  }
  assert {
    condition     = alltrue([for rule in digitalocean_firewall.remoteshield.outbound_rule : toset(rule.destination_addresses) == toset(rule.port_range == "53" ? var.resolver_egress_cidrs : var.web_egress_cidrs)])
    error_message = "Each egress rule should use the matching destination allowlist."
  }
  assert {
    condition     = digitalocean_droplet.remoteshield.backups == false
    error_message = "Provider billing add-ons require deliberate enablement."
  }
}

run "optional_scim_ingress" {
  command = plan
  variables {
    scim_source_cidrs = ["198.51.100.0/24"]
  }
  assert {
    condition     = length(digitalocean_firewall.remoteshield.inbound_rule) == 3
    error_message = "SCIM should add one explicitly scoped TLS ingress rule."
  }
}

run "optional_ntp_egress" {
  command = plan
  variables {
    ntp_egress_cidrs = ["192.0.2.123/32"]
  }
  assert {
    condition     = length([for rule in digitalocean_firewall.remoteshield.outbound_rule : rule if rule.protocol == "udp" && rule.port_range == "123" && toset(rule.destination_addresses) == toset(var.ntp_egress_cidrs)]) == 1
    error_message = "NTP should use UDP/123 and only the approved time server addresses."
  }
}

run "reject_default_routes" {
  command = plan
  variables {
    vpn_client_cidrs      = ["198.51.100.1/0"]
    web_egress_cidrs      = ["2001:db8::/0"]
    resolver_egress_cidrs = ["0.0.0.0/0"]
    ntp_egress_cidrs      = ["::/0"]
  }
  expect_failures = [var.vpn_client_cidrs, var.web_egress_cidrs, var.resolver_egress_cidrs, var.ntp_egress_cidrs]
}

run "reject_unrestricted_ssh" {
  command = plan
  variables {
    admin_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.admin_cidrs]
}
