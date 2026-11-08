# Existing cleanup remains independent from the selected speech provider.
# #27 grants this same exact-secret permission with its database policy;
# when combining branches, retain at least one binding for cleanup.
resource "aws_iam_role_policy" "openai" {
  count = var.stt_openai_secret_arn == null ? 0 : 1
  name  = "${local.prefix}-openai-secret"
  role  = aws_iam_role.compute.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = var.stt_openai_secret_arn
    }]
  })
}
