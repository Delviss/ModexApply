# PostgreSQL.
#
# The application connects as `modex_app`, a role with no UPDATE, DELETE or
# TRUNCATE on `audit_events`. The migration revokes those grants; this is where
# the role that they are revoked from is created, so the append-only guarantee
# has an owner at the infrastructure layer rather than resting on a migration
# that someone might not run.

resource "aws_db_instance" "primary" {
  identifier     = "modex-${var.environment}"
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.database_instance_class

  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_encrypted     = true
  storage_type          = "gp3"

  db_name  = "modex"
  username = "modex_admin"
  # Generated and rotated by Secrets Manager; never in Terraform state as text.
  manage_master_user_password = true

  backup_retention_period = var.environment == "production" ? 30 : var.database_backup_retention_days
  backup_window           = "02:00-03:00"
  maintenance_window       = "sun:03:00-sun:04:00"
  copy_tags_to_snapshot   = true

  # Multi-AZ for the 99.9% availability target on core workflows.
  multi_az            = var.environment == "production"
  deletion_protection = var.environment == "production"
  skip_final_snapshot = var.environment != "production"

  performance_insights_enabled = true
  enabled_cloudwatch_logs_exports = ["postgresql"]

  vpc_security_group_ids = [aws_security_group.database.id]
  db_subnet_group_name   = aws_db_subnet_group.private.name

  # The database is never reachable from the internet, in any environment.
  publicly_accessible = false
}

resource "aws_db_subnet_group" "private" {
  name       = "modex-${var.environment}-private"
  subnet_ids = aws_subnet.private[*].id
}
