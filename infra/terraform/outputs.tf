output "shares_table_name" {
  value       = aws_dynamodb_table.shares.name
  description = "DYNAMODB_TABLE_NAME for the selected Amplify branch."
}

output "compute_role_arn" {
  value       = aws_iam_role.compute.arn
  description = "Attach manually to the existing Amplify branch's compute role setting."
}

output "runtime_environment" {
  value = {
    READINGS_SAMPLE     = "false"
    READINGS_SOURCE     = "s3"
    READINGS_S3_BUCKET  = aws_s3_bucket.readings.id
    READINGS_S3_KEY     = aws_s3_object.readings.key
    READINGS_REGION     = data.aws_region.current.region
    SHARE_PERSISTENCE   = "dynamodb"
    DYNAMODB_TABLE_NAME = aws_dynamodb_table.shares.name
    DYNAMODB_REGION     = data.aws_region.current.region
  }
  description = "Non-secret server-only settings. Never put AWS keys in Amplify variables."
}
