project_name         = "doorknob"
create_soniox_secret = false
environment          = "prod"
deletion_protection  = true

# Replace with the licensed catalog path for this environment.
readings_yaml_path = "readings.example.yaml"

# Deliberately blocked in prod until a complete licensed catalog is selected.
readings_sample = true

# Production plans intentionally fail until real reviewed app/recipient values are supplied.
amplify_app_id          = null
budget_emails           = []
monthly_budget_usd      = { total = 100 }
waf_block               = false # Observe COUNT metrics, then switch to true before launch.
production_launch_ready = false # Set true only after docs/PRELAUNCH.md verification.
