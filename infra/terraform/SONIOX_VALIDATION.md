# Speech infrastructure validation

PR #28 is based on `main` plus PR #23's provider configuration, independently of PR #27. All database resources, DynamoDB runtime dependencies, persistence selection/helpers/tests and retention changes remain in #27. The original combined branch is preserved locally as `backup/soniox-before-database-split`.

The Terraform root, bootstrap, remote S3 state/native locking, provider versions, environment naming/tags and existing compute-role naming follow #27 so the branches can share a single stack. Shared-file conflicts should retain one common definition and #27's database additions; never apply the branches using separate state/resource sets.

Validation results for the revised branch are recorded after running the application and Terraform checks. No AWS plan/apply, secret-value provisioning, branch role association, hosted deployment or live provider test is performed. Local WebKit execution previously failed because required host libraries were missing; physical iPhone Safari/Android Chrome and live-provider acceptance remain release checks.

Role creation remains outside #28. Soniox policies target an existing role, defaulting to #27’s role name, so no duplicate role resource is introduced. Shared variable additions and runbooks may need a small merge reconciliation; database application files are unchanged from main.
