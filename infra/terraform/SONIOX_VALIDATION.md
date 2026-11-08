# Speech infrastructure validation

PR #28 is based on `main` plus PR #23's provider configuration, independently of PR #27. All database resources, DynamoDB runtime dependencies, persistence selection/helpers/tests and retention changes remain in #27. The original combined branch is preserved locally as `backup/soniox-before-database-split`.

The Terraform root, bootstrap, remote S3 state/native locking, provider versions, environment naming/tags and existing compute-role naming follow #27 so the branches can share a single stack. Shared-file conflicts should retain one common definition and #27's database additions; never apply the branches using separate state/resource sets.

Revised-branch checks: `npm run check` passed (formatting, ESLint, OpenAPI/Spectral, 108 automated tests and production build), separate TypeScript passed, and both Terraform roots passed recursive formatting, backend-disabled initialization and validation with Terraform 1.17.1 / AWS provider 6.72.0. Six mobile/desktop Chromium Soniox browser cases and 98 OpenAI regression cases passed (six Soniox cases intentionally skipped in the OpenAI run). No AWS plan/apply, secret-value provisioning, branch role association, hosted deployment or live provider test is performed. Local WebKit execution previously failed because required host libraries were missing; physical iPhone Safari/Android Chrome and live-provider acceptance remain release checks.

Role creation remains outside #28. Soniox policies target an existing role, defaulting to #27’s role name, so no duplicate role resource is introduced. Shared variable additions and runbooks may need a small merge reconciliation; database application files are unchanged from main.

The merge simulation with #27 has no application/resource-definition conflicts. Remaining reconciliation is limited to the two READMEs, common Terraform variables, the test command and two platform-checksum lockfiles; preserve both provider hashes.
