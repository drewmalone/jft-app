variable "readings_yaml_path" {
  type        = string
  default     = null
  nullable    = true
  description = "Optional YAML file relative to this Terraform root (or absolute). Its readings list becomes managed date-keyed items. Example: readings.example.yaml."
}

locals {
  readings = var.readings_yaml_path == null ? [] : yamldecode(file(var.readings_yaml_path)).readings
}

resource "aws_dynamodb_table" "readings" {
  name                        = "${local.prefix}-readings"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "date"
  deletion_protection_enabled = var.deletion_protection
  attribute {
    name = "date"
    type = "S"
  }
  server_side_encryption {
    enabled = true
  }
  lifecycle {
    precondition {
      condition = alltrue([for reading in local.readings : try(
        reading.date == formatdate("YYYY-MM-DD", "${reading.date}T00:00:00Z") &&
        reading.title == tostring(reading.title) && length(trimspace(reading.title)) > 0 && length(reading.title) <= 500 &&
        reading.body == tostring(reading.body) && length(trimspace(reading.body)) > 0 && length(reading.body) <= 50000,
        false
      )])
      error_message = "Each reading needs an ISO date, a nonblank string title (up to 500 characters), and body (up to 50000 characters). Quote dates in YAML."
    }
  }
}

# Editorial text is public content. Terraform state will contain the complete text.
# Date is the resource key: edits update that date; removed YAML entries delete managed rows.
resource "aws_dynamodb_table_item" "reading" {
  for_each   = { for reading in local.readings : reading.date => reading }
  table_name = aws_dynamodb_table.readings.name
  hash_key   = aws_dynamodb_table.readings.hash_key
  item = jsonencode({
    date  = { S = each.value.date }
    title = { S = each.value.title }
    body  = { S = each.value.body }
  })
}

output "readings_table_name" {
  value       = aws_dynamodb_table.readings.name
  description = "READINGS_TABLE_NAME for the runtime."
}
