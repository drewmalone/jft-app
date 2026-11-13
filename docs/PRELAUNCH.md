# Production launch verification

Merging code does not associate WAF, enable blocking, deliver alerts or deploy AWS resources. Complete this checklist against the selected **live AWS account and production Amplify app**, and retain the date, reviewer and evidence in the deployment record. Do not record private share URLs, report bodies, cookies or provider secrets.

## Review the production configuration

- [ ] Select the existing production backend/account/region and existing Amplify app. Do not create a replacement app or reuse dev state.
- [ ] Set the real `amplify_app_id` and reviewed `budget_emails`. Both production templates set `monthly_budget_usd = { total = 100 }`. This is a $100 monthly AWS alert budget, not a hard spending limit. The current total budget covers the AWS account; it does not include Soniox/OpenAI spending or filter to this app.
- [ ] Use an authorized complete reading catalog with `readings_sample=false`, distributed quotas, durable shares and stable runtime signing. See [Security operations](SECURITY_OPERATIONS.md).
- [ ] Review per-IP limits for shared meeting networks: API GET 5000, paid POST 300, share/session POST 500, public GET 3000, and CSP-report POST 300, each per five minutes by default. WAF rates are approximate and do not replace provider limits or atomic owner quotas.

Supply real values in the reviewed deployment configuration, for example an ignored `infra/terraform/environments/prod-security.local.tfvars` override:

```hcl
# Replace placeholders; Terraform rejects them.
amplify_app_id = "<existing-production-app-id>"
budget_emails = ["<reviewed-budget-recipient>"]
monthly_budget_usd = { total = 100 }
waf_block = false
production_launch_ready = false
```

Review the plan with the selected production template and override. Production plans reject a missing app ID, missing recipients or missing total budget. `production_launch_ready=false` allows an observation deployment in COUNT; it does **not** mean ready for public launch. Keep paid features disabled and traffic restricted to operator testing during observation.

## Verify the live observation deployment

- [ ] In Amplify's production app security settings, verify the actual associated Web ACL ARN. In AWS WAF, verify that same ACL exists with **CLOUDFRONT** scope in **us-east-1**, has the expected environment name, and lists the intended Amplify app as an associated resource. Check the association status after propagation. Association affects every branch of the app.
- [ ] Inspect the **live** ACL rules, not only a saved plan. Confirm path, method, source-IP aggregation, five-minute window, thresholds and priorities match the reviewed plan. In particular, `csp` must match `POST /api/csp-report`; paid endpoints must match POST. Confirm request samples and full request/body logging remain disabled.
- [ ] Observe `AWS/WAFV2` CountedRequests/AllowedRequests and app error/latency metrics under representative permitted traffic. Review shared-IP traffic and expected CSP-report volume. Rate rules in COUNT do not stop sustained requests from reaching DynamoDB or compute. Do not conduct a billable provider load test.
- [ ] In AWS Budgets, verify the live production total budget is **USD 100 / MONTHLY**, with ACTUAL greater-than-80% and FORECASTED greater-than-100% notifications and the intended email recipients. Inspect notification/subscriber configuration and confirm delivery using a reviewed test budget/notification exercise. Record delivery evidence; merely listing a recipient is not proof of delivery. Forecast alerts also depend on sufficient billing history.
- [ ] Verify provider-specific usage limits and alerts separately. AWS Budgets notifications are delayed alerts, not a circuit breaker.

For a read-only CLI inspection of the live rule configuration, use the real ACL name and ID:

```sh
aws wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1 --name <acl-name> --id <acl-id>
```

Use the AWS console association view to cross-check the resource. Do not dump request samples, private URLs or report bodies into the verification record.

## Transition to blocking and approve launch

- [ ] After observation and review, set `waf_block=true`, review/apply the plan through the normal infrastructure process, and wait for propagation. Reinspect the live association and rules: all five rate rules must use **BLOCK** and the managed common rule group must enforce its rules. The existing body-size/XSS body overrides deliberately remain COUNT to preserve the application's text contract.
- [ ] Repeat live association, rule/action and budget/recipient verification. A normal successful request alone does not prove WAF blocking is configured. Check aggregate metrics; validate enforcement in a controlled staging exercise rather than flooding production.
- [ ] Only after those checks, record `production_launch_ready=true` in the reviewed production configuration and plan again. Terraform rejects a launch declaration with COUNT mode. The flag records operator intent; it is not automated attestation of live AWS state or alert delivery.
- [ ] Record the reviewer, account/app/ACL identifiers, observed live configuration, alert-delivery evidence and rollback owner. Enable paid features/public launch only after verification is complete. Recheck after infrastructure, app-association, recipient or rate-limit changes.

If any check is unknown or fails, leave launch readiness false and resolve it. No live AWS verification or infrastructure apply is performed by repository tests.
