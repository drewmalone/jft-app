# Separate ephemeral counters from persistent sensitive shares.
resource "aws_dynamodb_table" "quotas" {
  name         = "${local.prefix}-quotas"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  on_demand_throughput {
    max_read_request_units  = var.dynamodb_max_read_units
    max_write_request_units = var.dynamodb_max_write_units
  }
  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  server_side_encryption { enabled = true }
}
resource "aws_iam_role_policy" "quotas" {
  name = "${local.prefix}-quotas"
  role = aws_iam_role.compute.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = aws_dynamodb_table.quotas.arn, Condition = { "ForAllValues:StringNotLike" = { "dynamodb:LeadingKeys" = ["control:*"] } } },
    { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.quotas.arn, Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["control:*"] } } }
  ] })
}
output "quota_table_name" { value = aws_dynamodb_table.quotas.name }

variable "budget_emails" {
  type    = set(string)
  default = []
}
variable "monthly_budget_usd" {
  description = "Example launch alert thresholds, not hard spending limits. Empty disables budgets."
  type        = map(number)
  default     = {}
  validation {
    condition     = alltrue([for k, v in var.monthly_budget_usd : contains(["total", "dynamodb", "amplify"], k) && v > 0])
    error_message = "Use positive total, dynamodb and/or amplify thresholds."
  }
}
resource "aws_budgets_budget" "security" {
  for_each     = length(var.budget_emails) > 0 ? var.monthly_budget_usd : {}
  name         = "${local.prefix}-${each.key}"
  budget_type  = "COST"
  limit_amount = tostring(each.value)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  dynamic "cost_filter" {
    for_each = each.key == "total" ? [] : [each.key == "dynamodb" ? "Amazon DynamoDB" : "AWS Amplify"]
    content {
      name   = "Service"
      values = [cost_filter.value]
    }
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_emails
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_emails
  }
}
variable "dynamodb_max_read_units" {
  description = "Optional on-demand read ceiling per table/index; -1 means uncapped. May throttle legitimate traffic."
  type        = number
  default     = -1
}
variable "dynamodb_max_write_units" {
  description = "Optional on-demand write ceiling per table/index; -1 means uncapped. May throttle legitimate traffic."
  type        = number
  default     = -1
}
