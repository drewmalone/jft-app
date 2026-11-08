output "compute_role_arn" {
  value       = aws_iam_role.compute.arn
  description = "Attach manually to the existing Amplify branch's compute role setting."
}
