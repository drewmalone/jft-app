# Mocked provider: these plans never contact an AWS account.
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  project_name         = "review-test"
  environment          = "dev"
  create_soniox_secret = false
}

run "optional_secrets_absent" {
  command = plan
}

run "valid_secret_arns" {
  command = plan
  variables {
    stt_soniox_secret_arn = "arn:aws:secretsmanager:us-west-2:123456789012:secret:soniox-test"
    stt_openai_secret_arn = "arn:aws:secretsmanager:us-west-2:123456789012:secret:openai-test"
  }
}

run "malformed_soniox_arn" {
  command = plan
  variables {
    stt_soniox_secret_arn = "invalid"
  }
  expect_failures = [var.stt_soniox_secret_arn]
}

run "wrong_openai_service" {
  command = plan
  variables {
    stt_openai_secret_arn = "arn:aws:s3:us-west-2:123456789012:bucket:wrong-service"
  }
  expect_failures = [var.stt_openai_secret_arn]
}
