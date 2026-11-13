variable "readings_sample" {
  type        = bool
  default     = true
  description = "Keep true for sample content. Production requires a complete licensed catalog and false."
}
variable "readings_yaml_path" {
  type        = string
  nullable    = false
  description = "YAML catalog path relative to this Terraform root (or absolute). Keep this in the environment tfvars."
}
locals {
  readings = yamldecode(file(var.readings_yaml_path))
}
data "aws_caller_identity" "current" {}
resource "aws_s3_bucket" "readings" {
  bucket = "${local.prefix}-readings-${data.aws_caller_identity.current.account_id}-${data.aws_region.current.region}"
}
resource "aws_s3_bucket_public_access_block" "readings" {
  bucket                  = aws_s3_bucket.readings.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "readings" {
  bucket = aws_s3_bucket.readings.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "readings" {
  bucket = aws_s3_bucket.readings.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "readings" {
  bucket = aws_s3_bucket.readings.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_object" "readings" {
  bucket       = aws_s3_bucket.readings.id
  key          = "just-for-today.yaml"
  source       = var.readings_yaml_path
  source_hash  = filemd5(var.readings_yaml_path)
  content_type = "application/yaml"
  depends_on   = [aws_s3_bucket_versioning.readings, aws_s3_bucket_server_side_encryption_configuration.readings]
  lifecycle {
    precondition {
      condition     = var.environment != "prod" || (!var.readings_sample && basename(var.readings_yaml_path) != "readings.example.yaml" && length(local.readings) == 366)
      error_message = "Production requires a complete 366-day non-example catalog with readings_sample=false."
    }
    precondition {
      condition = length(local.readings) <= 366 && length(filebase64(var.readings_yaml_path)) <= 13981016 && length(distinct([for reading in local.readings : reading.date])) == length(local.readings) && alltrue([for reading in local.readings : try(
        reading.date == formatdate("MM-DD", "2000-${reading.date}T00:00:00Z") &&
        reading.title == tostring(reading.title) && length(trimspace(reading.title)) > 0 && length(reading.title) <= 500 &&
        reading.quote == tostring(reading.quote) && length(trimspace(reading.quote)) > 0 && length(reading.quote) <= 5000 &&
        reading.source == tostring(reading.source) && length(trimspace(reading.source)) > 0 && length(reading.source) <= 1000 &&
        reading.body == tostring(reading.body) && length(trimspace(reading.body)) > 0 && length(reading.body) <= 50000,
        false
      )])
      error_message = "Catalog dates must be unique, with at most 366 readings and 10 MiB of YAML. Each reading needs a valid MM-DD, a nonblank string title (up to 500 characters), quote (up to 5000), source (up to 1000), and body (up to 50000 characters). Quote dates in YAML."
    }
  }
}
output "readings_bucket_name" {
  value       = aws_s3_bucket.readings.id
  description = "Private YAML catalog bucket."
}
