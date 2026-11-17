terraform {
  required_version = ">= 1.9, < 2.0"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

# DIGITALOCEAN_TOKEN is supplied privately by the operator.
provider "digitalocean" {}

resource "digitalocean_droplet" "remoteshield" {
  name       = var.name
  region     = var.region
  size       = var.size
  image      = "ubuntu-24-04-x64"
  ssh_keys   = var.ssh_key_fingerprints
  ipv6       = true
  monitoring = true
  backups    = var.enable_provider_backups
  tags       = ["remoteshield", var.environment]
  user_data  = templatefile("${path.module}/cloud-init.yml.tftpl", { admin_public_key = jsonencode(var.admin_public_key) })

  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_firewall" "remoteshield" {
  name        = "${var.name}-ingress"
  droplet_ids = [digitalocean_droplet.remoteshield.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.admin_cidrs
  }
  inbound_rule {
    protocol         = "udp"
    port_range       = "51820"
    source_addresses = var.vpn_client_cidrs
  }
  dynamic "inbound_rule" {
    for_each = length(var.scim_source_cidrs) > 0 ? [1] : []
    content {
      protocol         = "tcp"
      port_range       = "443"
      source_addresses = var.scim_source_cidrs
    }
  }
  inbound_rule {
    protocol         = "icmp"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

output "public_ipv4" { value = digitalocean_droplet.remoteshield.ipv4_address }
output "operator_ssh" { value = "ssh rsxops@${digitalocean_droplet.remoteshield.ipv4_address}" }
