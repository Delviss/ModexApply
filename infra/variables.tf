variable "environment" {
  description = "Deployment environment."
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be development, staging or production."
  }
}

variable "region" {
  description = <<-EOT
    Cloud region. No default on purpose: which region is lawful depends on the
    launch market's data rules, and that is still an open decision
    (issue #1 section 7). Choosing one here would settle it by accident.
  EOT
  type        = string
}

variable "database_instance_class" {
  description = "PostgreSQL instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "database_backup_retention_days" {
  description = "Point-in-time recovery window. Production keeps a month."
  type        = number
  default     = 7
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs permitted to reach the application load balancer."
  type        = list(string)
  default     = []
}
