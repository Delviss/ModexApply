# Network.
#
# Application and database subnets are private. Only the load balancer sits in a
# public subnet, and its ingress is an explicit allowlist rather than 0.0.0.0/0.

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_security_group" "database" {
  name        = "modex-${var.environment}-database"
  description = "PostgreSQL access from the application tier only"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.application.id]
    description     = "PostgreSQL from the application tier"
  }
}

resource "aws_security_group" "application" {
  name        = "modex-${var.environment}-application"
  description = "Application tier"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to university connectors and managed services"
  }
}
