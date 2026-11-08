# Existing cleanup remains independent from the selected speech provider.
# #27 grants this same exact-secret permission with its database policy;
# when combining branches, retain at least one binding for cleanup.
resource "aws_iam_role_policy" "openai" {
  count = var.stt_openai_secret_arn == null ? 0 : 1
  name  = "${local.soniox_prefix}-openai-secret"
  role  = local.soniox_compute_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = var.stt_openai_secret_arn
    }]
  })
}
