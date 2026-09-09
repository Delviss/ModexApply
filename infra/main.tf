# Modex Apply infrastructure.
#
# Region is deliberately a variable with no default. Which region is lawful
# depends on the launch market's data rules, and that is an open decision
# (issue #1 section 7, decision 6). A default here would quietly make it.

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State holds resource identifiers and occasionally secrets. Encrypted,
  # versioned, and locked so two applies cannot race.
  backend "s3" {
    key            = "modex-apply/terraform.tfstate"
    encrypt        = true
    dynamodb_table = "modex-terraform-locks"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "modex-apply"
      Environment = var.environment
      ManagedBy   = "terraform"
      # Student documents and application data are personal data. Tagging it as
      # such is what lets a retention policy find it later.
      DataClass = "personal-data"
    }
  }
}
