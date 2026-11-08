locals {
  prefix = "${var.project_name}-${var.environment}"
}

# AWS's documented Hosting SSR compute trust principal. Associate only with the
# intended branch; do not attach as an app default shared with untrusted previews.
data "aws_iam_policy_document" "compute_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["amplify.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "compute" {
  name               = "${local.prefix}-ssr-compute"
  assume_role_policy = data.aws_iam_policy_document.compute_trust.json
}

