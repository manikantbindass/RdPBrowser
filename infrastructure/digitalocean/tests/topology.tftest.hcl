mock_provider "digitalocean" {}

run "reject_noncanonical_ssh_wildcard" {
  command = plan
  variables {
    admin_cidrs = ["198.51.100.1/0"]
  }
  expect_failures = [var.admin_cidrs]
}

variables {
  ssh_key_fingerprints = ["mock-key"]
  admin_public_key     = "ssh-ed25519 AAAATESTONLY operator-fixture"
  admin_cidrs          = ["203.0.113.10/32"]
}

run "single_vps_defaults" {
  command = plan
  assert {
    condition     = digitalocean_droplet.remoteshield.size == "s-2vcpu-4gb"
    error_message = "The reference topology should use one documented VPS size."
  }
  assert {
    condition     = length(digitalocean_firewall.remoteshield.inbound_rule) == 3
    error_message = "Default ingress should contain SSH, WireGuard and ICMP only."
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
    condition     = length(digitalocean_firewall.remoteshield.inbound_rule) == 4
    error_message = "SCIM should add one explicitly scoped TLS ingress rule."
  }
}

run "reject_unrestricted_ssh" {
  command = plan
  variables {
    admin_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.admin_cidrs]
}
