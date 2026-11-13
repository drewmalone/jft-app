provider "aws" {
  alias  = "global"
  region = "us-east-1"
  default_tags {
    tags = merge(var.tags, {
      Application = var.project_name, Environment = var.environment, ManagedBy = "Terraform"
    })
  }
}
variable "amplify_app_id" {
  description = "Existing Amplify app; null creates no WAF or association. Association covers every branch of the app."
  type        = string
  default     = null
  validation {
    condition     = var.amplify_app_id == null ? true : can(regex("^d[a-z0-9]+$", var.amplify_app_id))
    error_message = "Use the actual existing Amplify app ID, or null outside production."
  }
}
variable "waf_block" {
  description = "Start in COUNT; enable blocking after reviewing aggregate metrics."
  type        = bool
  default     = false
}
# Every scoped rate rule is described once; thresholds may be overridden independently.
locals {
  waf_rules = {
    api    = { priority = 10, method = "GET", pattern = "^/api/", default_limit = 5000 }
    paid   = { priority = 20, method = "POST", pattern = "^/api/(transcription/session|shares/cleanup)$", default_limit = 300 }
    create = { priority = 30, method = "POST", pattern = "^/api/(shares|session)$", default_limit = 500 }
    public = { priority = 40, method = "GET", pattern = "^/(s/|api/public/shares/)", default_limit = 3000 }
    csp    = { priority = 45, method = "POST", pattern = "^/api/csp-report$", default_limit = 300 }
  }
  waf_limits = merge({ for name, rule in local.waf_rules : name => rule.default_limit }, var.waf_rate_limits)
}
variable "waf_rate_limits" {
  description = "Optional per-rule overrides, per source IP per five minutes; omitted rules keep their declared defaults."
  type        = map(number)
  default     = {}
  validation {
    condition     = alltrue([for name, limit in var.waf_rate_limits : contains(keys(local.waf_rules), name) && limit >= 10 && limit <= 2000000000 && floor(limit) == limit])
    error_message = "Override only known WAF rule names with whole-number thresholds from 10 to 2000000000."
  }
}
data "aws_caller_identity" "waf" {}
data "aws_partition" "waf" {}
resource "aws_wafv2_web_acl" "security" {
  count    = var.amplify_app_id == null ? 0 : 1
  provider = aws.global
  name     = "${local.prefix}-security"
  scope    = "CLOUDFRONT"
  region   = "us-east-1"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.prefix}-security"
    sampled_requests_enabled   = false

  }
  dynamic "rule" {
    for_each = local.waf_rules
    content {
      name     = rule.key
      priority = rule.value.priority
      action {
        dynamic "count" {
          for_each = var.waf_block ? [] : [1]
          content {}
        }
        dynamic "block" {
          for_each = var.waf_block ? [1] : []
          content {}
        }

      }
      statement {
        rate_based_statement {
          limit              = local.waf_limits[rule.key]
          aggregate_key_type = "IP"
          scope_down_statement {
            and_statement {
              statement {
                regex_match_statement {
                  regex_string = rule.value.pattern
                  field_to_match {
                    uri_path {}
                  }
                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }

                }

              }
              statement {
                byte_match_statement {
                  positional_constraint = "EXACTLY"
                  search_string         = rule.value.method
                  field_to_match {
                    method {}
                  }
                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }

                }

              }

            }

          }

        }

      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.prefix}-${rule.key}"
        sampled_requests_enabled   = false

      }

    }

  }
  rule {
    name     = "common-threats"
    priority = 50
    override_action {
      dynamic "count" {
        for_each = var.waf_block ? [] : [1]
        content {}
      }
      dynamic "none" {
        for_each = var.waf_block ? [1] : []
        content {}
      }

    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
        # Recovery text and the existing 64KiB body contract can trigger these rules.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }

        }
        rule_action_override {
          name = "CrossSiteScripting_BODY"
          action_to_use {
            count {}
          }

        }

      }

    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.prefix}-common"
      sampled_requests_enabled   = false

    }

  }
}
# Amplify uses AssociateWebACL with the Amplify ARN, unlike customer CloudFront distributions.
resource "aws_wafv2_web_acl_association" "amplify" {
  count        = var.amplify_app_id == null ? 0 : 1
  provider     = aws.global
  resource_arn = "arn:${data.aws_partition.waf.partition}:amplify:${data.aws_region.current.region}:${data.aws_caller_identity.waf.account_id}:apps/${var.amplify_app_id}"
  web_acl_arn  = aws_wafv2_web_acl.security[0].arn
}
