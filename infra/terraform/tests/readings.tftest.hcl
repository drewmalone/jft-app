mock_provider "aws" {
  alias = "global"
}

mock_provider "aws" {
  override_during = plan
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_region" { defaults = { region = "us-west-2" } }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::fictional-readings", id = "fictional-readings" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}
variables {
  project_name         = "readings-test"
  environment          = "dev"
  create_soniox_secret = false
  readings_yaml_path   = "readings.example.yaml"
}
run "private_catalog_and_read_only_runtime" {
  command = plan
  assert {
    condition     = output.runtime_environment.READINGS_SAMPLE == "true" && output.runtime_environment.DEPLOYMENT_ENV == "dev" && output.runtime_environment.QUOTA_TABLE_NAME == aws_dynamodb_table.quotas.name
    error_message = "Runtime must preserve sample labeling and explicit deployment/storage isolation."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.readings.block_public_acls && aws_s3_bucket_public_access_block.readings.block_public_policy && aws_s3_bucket_public_access_block.readings.ignore_public_acls && aws_s3_bucket_public_access_block.readings.restrict_public_buckets
    error_message = "Editorial storage must remain private."
  }
  assert {
    condition     = aws_s3_bucket_versioning.readings.versioning_configuration[0].status == "Enabled"
    error_message = "Editorial publications need recoverable versions."
  }
  assert {
    condition     = [for statement in data.aws_iam_policy_document.shares.statement : statement if statement.sid == "ReadDailyReadings"][0].actions == toset(["s3:GetObject"])
    error_message = "Runtime must only read published content."
  }
  assert {
    condition     = [for statement in data.aws_iam_policy_document.shares.statement : statement if statement.sid == "ReadDailyReadings"][0].resources == toset(["${aws_s3_bucket.readings.arn}/${aws_s3_object.readings.key}"])
    error_message = "Runtime access must target the one published object."
  }
  assert {
    condition     = output.runtime_environment.READINGS_SOURCE == "s3" && output.runtime_environment.READINGS_S3_BUCKET == aws_s3_bucket.readings.id && output.runtime_environment.READINGS_S3_KEY == aws_s3_object.readings.key
    error_message = "Runtime must select the provisioned catalog."
  }
  assert {
    condition     = aws_s3_object.readings.source == var.readings_yaml_path && aws_s3_object.readings.source_hash == filemd5(var.readings_yaml_path)
    error_message = "Catalog edits must update the entire publication."
  }
}
run "invalid_calendar_date" {
  command = plan
  variables { readings_yaml_path = "tests/fixtures/invalid-readings.yaml" }
  expect_failures = [aws_s3_object.readings]
}

run "duplicate_dates" {
  command = plan
  variables { readings_yaml_path = "tests/fixtures/duplicate-readings.yaml" }
  expect_failures = [aws_s3_object.readings]
}

run "missing_attribution" {
  command = plan
  variables { readings_yaml_path = "tests/fixtures/missing-attribution.yaml" }
  expect_failures = [aws_s3_object.readings]
}

run "leap_day_is_a_valid_annual_key" {
  command = plan
  variables { readings_yaml_path = "tests/fixtures/leap-day-readings.yaml" }
  assert {
    condition     = local.readings[0].date == "02-29"
    error_message = "Annual calendars must accept February 29 without binding the catalog to a year."
  }
}

run "production_partial_catalog_is_rejected_even_without_sample_label" {
  command = plan
  variables {
    amplify_app_id     = "dfictionalapp"
    budget_emails      = ["operator@example.com"]
    monthly_budget_usd = { total = 100 }
    environment        = "prod"
    readings_sample    = false
    readings_yaml_path = "tests/fixtures/leap-day-readings.yaml"
  }
  expect_failures = [aws_s3_object.readings]
}
