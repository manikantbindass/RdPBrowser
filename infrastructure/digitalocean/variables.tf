variable "name" {
  type    = string
  default = "remoteshield-production"
}
variable "region" {
  type    = string
  default = "blr1"
}
variable "size" {
  type    = string
  default = "s-2vcpu-4gb"
}
variable "environment" {
  type    = string
  default = "production"
  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "Use production or staging."
  }
}
variable "ssh_key_fingerprints" {
  type = list(string)
  validation {
    condition     = length(var.ssh_key_fingerprints) > 0
    error_message = "Register at least one existing operator SSH public key."
  }
}
variable "admin_public_key" {
  type = string
  validation {
    condition     = can(regex("^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$", var.admin_public_key)) && !strcontains(var.admin_public_key, "\n") && !strcontains(var.admin_public_key, "\r")
    error_message = "Supply an Ed25519 operator public key."
  }
}
variable "admin_cidrs" {
  type = list(string)
  validation {
    condition     = length(var.admin_cidrs) > 0 && alltrue([for cidr in var.admin_cidrs : can(cidrhost(cidr, 0)) && try(tonumber(split("/", cidr)[1]), 0) > 0])
    error_message = "Use explicit operator CIDRs for SSH."
  }
}
variable "vpn_client_cidrs" {
  type    = list(string)
  default = ["0.0.0.0/0", "::/0"]
  validation {
    condition     = length(var.vpn_client_cidrs) > 0 && alltrue([for cidr in var.vpn_client_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Supply valid VPN client CIDRs."
  }
}
variable "scim_source_cidrs" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for cidr in var.scim_source_cidrs : can(cidrhost(cidr, 0)) && try(tonumber(split("/", cidr)[1]), 0) > 0])
    error_message = "Supply verified provisioner source CIDRs."
  }
}
variable "enable_provider_backups" {
  type    = bool
  default = false
}
