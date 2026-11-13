# Give computed policy inputs stable values so least-privilege checks run at plan time.
override_resource {
  target          = aws_dynamodb_table.quotas
  values          = { arn = "arn:aws:dynamodb:us-west-2:123456789012:table/fictional-quotas" }
  override_during = plan
}
mock_provider "aws" {
  override_during = plan
  mock_data "aws_iam_policy_document" { defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" } }
  mock_data "aws_partition" { defaults = { partition = "aws" } }
  mock_data "aws_region" { defaults = { region = "us-west-2" } }
  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
}
mock_provider "aws" {
  alias           = "global"
  override_during = plan
}
variables {
  readings_yaml_path   = "readings.example.yaml"
  create_soniox_secret = false
  project_name         = "review"
  environment          = "dev"
  amplify_app_id       = "dfictionalapp"
  budget_emails        = ["operator@example.com"]
  monthly_budget_usd   = { total = 50, dynamodb = 10, amplify = 20 }
}
run "security_resources" {
  command = plan
  assert {
    condition     = aws_wafv2_web_acl.security[0].scope == "CLOUDFRONT" && aws_wafv2_web_acl.security[0].region == "us-east-1"
    error_message = "Amplify requires a global ACL in us-east-1."
  }
  assert {
    condition     = endswith(aws_wafv2_web_acl_association.amplify[0].resource_arn, ":apps/dfictionalapp")
    error_message = "Attach to existing Amplify app, never create an app or distribution."
  }
  assert {
    condition     = aws_dynamodb_table.shares.ttl[0].enabled == false && aws_dynamodb_table.quotas.ttl[0].enabled == true
    error_message = "Only ephemeral quota records may expire."
  }
  assert {
    condition     = length(aws_budgets_budget.security) == 3 && var.waf_block == false
    error_message = "Budgets must be explicit and WAF should start in COUNT."
  }
  assert {
    condition     = aws_dynamodb_table.quotas.name == "review-dev-quotas"
    error_message = "Quota tables must be isolated by environment."
  }
}
run "production_isolation" {
  expect_failures = [aws_s3_object.readings]
  command         = plan
  variables { environment = "prod" }
  assert {
    condition     = aws_dynamodb_table.quotas.name == "review-prod-quotas" && aws_dynamodb_table.shares.name == "review-prod-shares"
    error_message = "Production must not reuse dev table names."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.quotas.policy).Statement[0].Action == ["dynamodb:UpdateItem"] && jsondecode(aws_iam_role_policy.quotas.policy).Statement[1].Action == ["dynamodb:GetItem"]
    error_message = "SSR quota permissions must not expand to scans, deletion or operator control writes."
  }
}
run "no_opt_in_costs" {
  command = plan
  variables {
    amplify_app_id = null
    budget_emails  = []
  }
  assert {
    condition     = length(aws_wafv2_web_acl.security) == 0 && length(aws_budgets_budget.security) == 0
    error_message = "Local/default setup must not create WAF or budget notifications."
  }
}

run "csp_post_rate_rule" {
  command = plan
  assert {
    condition     = length([for rule in aws_wafv2_web_acl.security[0].rule : rule if rule.name == "csp" && rule.statement[0].rate_based_statement[0].limit == 300 && anytrue([for statement in rule.statement[0].rate_based_statement[0].scope_down_statement[0].and_statement[0].statement : try(statement.regex_match_statement[0].regex_string == "^/api/csp-report$", false)]) && anytrue([for statement in rule.statement[0].rate_based_statement[0].scope_down_statement[0].and_statement[0].statement : try(statement.byte_match_statement[0].search_string == "POST", false)])]) == 1
    error_message = "CSP POSTs need their own per-IP rate rule."
  }
}
run "production_missing_edge_and_budget_configuration" {
  command = plan
  variables {
    environment    = "prod"
    amplify_app_id = null
    budget_emails  = []
  }
  expect_failures = [terraform_data.production_security, aws_s3_object.readings]
}
run "launch_cannot_remain_count_only" {
  command = plan
  variables {
    environment             = "prod"
    production_launch_ready = true
    waf_block               = false
  }
  expect_failures = [terraform_data.production_security, aws_s3_object.readings]
}
run "reviewed_production_blocking_configuration" {
  command = plan
  variables {
    environment             = "prod"
    production_launch_ready = true
    waf_block               = true
    monthly_budget_usd      = { total = 100 }
  }
  expect_failures = [aws_s3_object.readings]
  assert {
    condition     = output.launch_security.launch_declared && output.launch_security.waf_mode == "BLOCK" && length(aws_budgets_budget.security) == 1 && aws_budgets_budget.security["total"].limit_amount == "100"
    error_message = "A reviewed launch must select BLOCK and the explicit monthly budget."
  }
}

run "partial_waf_override_keeps_other_defaults" {
  command = plan
  variables { waf_rate_limits = { csp = 100 } }
  assert {
    condition     = local.waf_limits["csp"] == 100 && local.waf_limits["paid"] == 300 && local.waf_rules["paid"].method == "POST" && local.waf_rules["api"].method == "GET"
    error_message = "A single override must not erase another rule's default or method."
  }
}
run "unknown_waf_override_is_rejected" {
  command = plan
  variables { waf_rate_limits = { misspelled = 100 } }
  expect_failures = [var.waf_rate_limits]
}
