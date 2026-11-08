# Speech infrastructure and deployment

## Soniox live transcription

This PR contains speech-provider infrastructure only. Database resources, persistence code, DynamoDB dependencies and tests, and retention changes belong exclusively to PR #27. The root, S3 backend/native locking, bootstrap, provider lockfiles, environment prefixes/tags and SSR compute role identity intentionally match #27. Use one shared state backend and one compute role when combining the PRs; do not apply each branch as a separate stack. PR #23's provider bootstrap is included; the separate xAI relay PR #22 is untouched.

This PR does not create an SSR role: it attaches narrowly scoped provider policies to an existing trusted role, defaulting to #27's `${project_name}-${environment}-ssr-compute` name. Override `amplify_compute_role_name` for an existing deployment. Provision that role through #27 (or your existing infrastructure) before applying these policies. This keeps all role/database additions in #27 and prevents duplicate role definitions when combining the PRs. Common provider/backend/bootstrap files match #27; retain the union of shared variables when merging. Speech-specific variables live in `soniox-variables.tf`, and environment settings in `environments/soniox-dev.tfvars` and `soniox-prod.tfvars`. The speech preparation helper is independent of #27's persistence helper.

### Account and secrets

1. Create a Soniox account/project with billing and usage monitoring. Create separate dev/prod API keys. Restrict each key to **Temporary API keys** plus **real-time speech-to-text** (`transcribe_websocket`); omit batch, TTS and translation permissions. Confirm permissions against [Soniox's current documentation](https://docs.soniox.com/authentication/api-key-permissions).
2. By default, Terraform creates only metadata for `doorknob-dev-soniox-api-key` or `doorknob-prod-soniox-api-key`, using the existing environment prefix/tags and AWS-managed Secrets Manager encryption. It creates no secret version and never reads the value into state. Populate the plain-string value separately through the AWS Secrets Manager console's secure value editor after manual apply. Do not pass key material through Terraform variables, outputs, CLI history, Git, build logs or build artifacts.
3. To reuse an existing secret, set `create_soniox_secret=false` and `stt_soniox_secret_arn` to its exact ARN in the environment's private local tfvars. Creating and referencing simultaneously fails validation at plan time. Setting false with no ARN intentionally omits Soniox permission. Keep `stt_openai_secret_arn` set for existing cleanup and OpenAI speech; credentials are independent.
4. `aws_iam_role_policy.soniox` attaches **only** `secretsmanager:GetSecretValue` on that exact configured secret to the shared SSR compute role. Optional OpenAI cleanup access is scoped separately in `openai.tf`. No static AWS credentials or new compute service is needed. Customer-managed KMS secrets additionally require a separately reviewed narrowly scoped `kms:Decrypt` permission and key policy; this code adds none.

Both committed `environments/soniox-dev.tfvars` and `soniox-prod.tfvars` use the default metadata creation; their existing environment, region, naming, tags, remote-state configuration remain authoritative. Optional private overrides contain ARNs and booleans only:

```hcl
create_soniox_secret   = false
stt_soniox_secret_arn  = "arn:aws:secretsmanager:us-west-2:123456789012:secret:existing-soniox-REPLACE"
stt_openai_secret_arn = "arn:aws:secretsmanager:us-west-2:123456789012:secret:existing-openai-REPLACE"
```

### Review and deploy manually

Bootstrap the shared remote state once per environment using the procedure below. Keep the same private encrypted versioned S3 backend and native locking. Example Bash commands from the repository root, after preparing the matching backend config and temporary AWS profile:

```bash
export AWS_PROFILE=doorknob-dev
export TF_DATA_DIR="$PWD/.tmp/terraform-dev"
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -reconfigure -backend-config=environments/dev.s3.tfbackend
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform plan -var-file=environments/soniox-dev.tfvars -var-file=environments/soniox-dev.local.tfvars -out=dev.tfplan
# Operator reviews account, environment, secret metadata and exact IAM resources.
terraform -chdir=infra/terraform apply dev.tfplan
terraform -chdir=infra/terraform output stt_soniox_secret_arn
```

Use distinct prod backend, profile, data directory, tfvars and plan for production. Omit the local var file if using defaults and no OpenAI secret binding; cleanup still requires its existing OpenAI configuration. Never use a secret value as a Terraform argument. Saved plans contain infrastructure metadata and should be kept private and deleted after use. These commands are operator instructions; no apply or AWS plan was run by this implementation.

For credential-free validation (also performed by the existing PR workflow):

```bash
terraform -chdir=infra/terraform fmt -check -recursive
terraform -chdir=infra/terraform init -backend=false -input=false
terraform -chdir=infra/terraform validate
terraform -chdir=infra/terraform/bootstrap init -backend=false -input=false
terraform -chdir=infra/terraform/bootstrap validate
```

Populate the secret securely, then manually associate the existing role ARN with only the intended trusted Amplify branch. An existing association to this same role needs no new role. Review existing policies before any association change. Never make a sensitive role the default for untrusted preview branches.

Set server-only Amplify runtime settings `STT_ENABLED=true`, `STT_PROVIDER=soniox`, `STT_SONIOX_SECRET_ARN=<output ARN>` and the existing `STT_OPENAI_SECRET_ARN` for cleanup. Preserve `SESSION_SECRET` and any existing required permissions. Run the existing `node scripts/prepare-transcription-env.mjs` before the build; it copies these allowlisted **non-secret** speech settings into `.env.production`. Keep API key values out of Amplify variables/artifacts; `STT_SONIOX_API_KEY` is development-only and ignored in production. Use compute-role SDK credentials at runtime. See [TRANSCRIPTION.md](../../docs/TRANSCRIPTION.md) for exact flow and device release checks.

### Costs, monitoring and rollback

Soniox charges for real-time audio usage; consult current account pricing rather than relying on a fixed rate here. Secrets Manager adds a per-secret/month and API-request cost (reads cache for five minutes per SSR process). Existing Amplify, state S3 and OpenAI cleanup costs continue. Monitor provider usage, rejected requests, credential issuance counts and unexpected concurrent sessions without logging credentials or speech. Anonymous signed sessions and process-local rate limits are insufficient public-launch spending protection; use distributed quotas, concurrency controls and provider controls before public exposure. Alerts may not stop spending.

To roll speech back, set `STT_PROVIDER=openai`, retain its key/secret and IAM access, rebuild/redeploy and reload clients. Cleanup already uses OpenAI. For a full paid-feature stop, set `STT_ENABLED=false` (also disables cleanup). An already issued Soniox credential may establish a stream during its 60-second lifetime; an active stream can continue to its enforced ten-minute limit. Disable/revoke the parent key in Soniox if immediate incident response is required, verifying the provider's revocation semantics.

Leave secret metadata/state intact during rollback; the created secret has `prevent_destroy` and a 30-day recovery window. Do not destroy the role/state bucket or remove OpenAI permission. Once reviewed, remove the Soniox inline policy by setting `create_soniox_secret=false` and no external ARN only after explicitly deciding how to retain/import the managed metadata; `prevent_destroy` intentionally blocks accidental removal of a managed secret. Deleting secrets or rotating live keys is a separate operator action. No production secret, branch association or AWS resource has been changed here.

## Bootstrap shared remote state

`bootstrap/` creates only a private, encrypted, versioned S3 state bucket with TLS-only access and public access blocked. It uses the same definitions as #27. If its bucket already exists under Terraform management, reuse its bootstrap state; do not bootstrap another bucket or import it independently. Bootstrap state initially lives in protected local storage outside Git.

```bash
export AWS_PROFILE=doorknob-dev
export TF_DATA_DIR="$PWD/.tmp/bootstrap-dev"
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan -var=environment=dev -var=aws_region=us-west-2 -var=bucket_name=REPLACE-WITH-UNIQUE-DEV-BUCKET -state="$PWD/.tmp/bootstrap-dev.tfstate" -out=bootstrap-dev.tfplan
# Review account, region and bucket; operator applies manually.
terraform -chdir=infra/terraform/bootstrap apply -state="$PWD/.tmp/bootstrap-dev.tfstate" bootstrap-dev.tfplan
```

Copy `environments/dev.s3.tfbackend.example` to the ignored matching backend file and set the real bucket. Production uses its own profile, bucket/backend key, data directory and variables. The application backend fixes encryption and native S3 locking; no lock table is needed. Commit dependency locks, never state, plans, keys or credentials. Grant state operators only the required S3 key/prefix permissions, including Get/Put/Delete for its `.tflock`; routine state deletion is unnecessary.

For branch association after reviewed apply, select the existing app and trusted branch manually:

```bash
aws amplify update-branch --app-id REPLACE_APP_ID --branch-name REPLACE_TRUSTED_BRANCH --compute-role-arn REPLACE_COMPUTE_ROLE_ARN
```

The operator needs narrowly scoped `amplify:UpdateBranch` and `iam:PassRole`; runtime code receives neither. Do not set this role as an app-wide default for untrusted previews. The compute role differs from Amplify's build service role. No AWS action is performed by these instructions automatically.
