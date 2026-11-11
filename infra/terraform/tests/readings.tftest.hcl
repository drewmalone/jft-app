mock_provider "aws" {
  override_during = plan
  mock_resource "aws_dynamodb_table" {
    defaults = { arn = "arn:aws:dynamodb:us-west-2:123456789012:table/readings-test" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}
variables {
  project_name         = "readings-test"
  environment          = "dev"
  create_soniox_secret = false
}
run "readings_are_date_keyed_and_runtime_is_read_only" {
  command = plan
  assert {
    condition     = aws_dynamodb_table.readings.hash_key == "date" && aws_dynamodb_table.readings.billing_mode == "PAY_PER_REQUEST"
    error_message = "Readings need a direct date key and on-demand capacity."
  }
  assert {
    condition     = [for statement in data.aws_iam_policy_document.shares.statement : statement if statement.sid == "ReadDailyReading"][0].actions == toset(["dynamodb:GetItem"])
    error_message = "Runtime must not upload or scan editorial content."
  }
  assert {
    condition     = [for statement in data.aws_iam_policy_document.shares.statement : statement if statement.sid == "ReadDailyReading"][0].resources == toset([aws_dynamodb_table.readings.arn])
    error_message = "Reading access must target the readings table only."
  }
  assert {
    condition     = output.runtime_environment.READINGS_SOURCE == "dynamodb" && output.runtime_environment.READINGS_TABLE_NAME == aws_dynamodb_table.readings.name
    error_message = "The runtime must explicitly select the provisioned table."
  }
  assert {
    condition     = length(aws_dynamodb_table_item.reading) == 0
    error_message = "Example content must not be uploaded implicitly."
  }
}
run "yaml_upload" {
  command = plan
  variables {
    readings_yaml_path = "readings.example.yaml"
  }
  assert {
    condition     = length(aws_dynamodb_table_item.reading) == 2 && jsondecode(aws_dynamodb_table_item.reading["2026-11-11"].item).date.S == "2026-11-11"
    error_message = "Every YAML date must become one managed item."
  }
  assert {
    condition     = jsondecode(aws_dynamodb_table_item.reading["2026-11-11"].item).body.S == local.readings[0].body
    error_message = "Import must preserve the reading body and line breaks."
  }
}
run "invalid_calendar_date" {
  command = plan
  variables {
    readings_yaml_path = "tests/fixtures/invalid-readings.yaml"
  }
  expect_failures = [aws_dynamodb_table.readings]
}
