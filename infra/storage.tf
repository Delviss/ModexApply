# Object storage for student documents.
#
# Documents never transit the API process: clients upload with a pre-signed PUT
# and download with a pre-signed GET, both short-lived. That keeps transcripts
# and passports out of application memory and out of every log line on the path.

resource "aws_s3_bucket" "documents" {
  bucket = "modex-${var.environment}-documents"
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  # Every one of these, in every environment. A student's passport scan behind a
  # guessable URL is the failure this prevents.
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.documents.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  # An application snapshot references an exact document version. Versioning is
  # what makes that reference resolvable after the student replaces the file.
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_kms_key" "documents" {
  description             = "Encrypts student documents at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}
