variable "environment" {
  type        = string
  description = "Explicit environment. Use separate backends and credentials for production."

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "project_name" {
  type        = string
  description = "Resource name prefix, explicitly supplied by the selected environment."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Additional resource tags."
}

variable "stt_openai_secret_arn" {
  type        = string
  default     = null
  nullable    = true
  description = "Optional existing Secrets Manager ARN used by STT_OPENAI_SECRET_ARN. Does not create or read a secret."

  validation {
    condition = var.stt_openai_secret_arn == null ? true : try(
      provider::aws::arn_parse(var.stt_openai_secret_arn).service == "secretsmanager" &&
      startswith(provider::aws::arn_parse(var.stt_openai_secret_arn).resource, "secret:"),
      false
    )
    error_message = "Use a Secrets Manager secret ARN."
  }
}
