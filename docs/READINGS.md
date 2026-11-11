# Daily Just for Today readings

Daily content lives in a separate DynamoDB table with a string partition key `date` (`YYYY-MM-DD`). One `GetItem` retrieves the reading; no secondary index, scan, audio storage or new backend service is needed. The runtime compute role can only read this table. Terraform's operator performs uploads.

## Content and import

The included [YAML example](../infra/terraform/readings.example.yaml) contains **fictional examples**, not a real reading library. Supply your own editorial content in this shape:

```yaml
readings:
  - date: '2026-11-11'
    title: A fictional title
    body: |
      A fictional first paragraph.

      A fictional second paragraph.
```

Use quoted, full ISO calendar dates, not timestamps or recurring month/day keys. Titles must be nonblank strings of at most 500 characters; bodies must be nonblank strings of at most 50,000 characters. Plain text and line breaks are preserved; HTML is not interpreted. Invalid calendar dates and duplicate dates fail Terraform planning. Include explicit leap-day entries when publishing leap years. Missing dates are unavailable; content is not silently borrowed from yesterday.

After selecting and initializing the appropriate backend/account as described in the [infrastructure runbook](../infra/terraform/README.md), review a plan with the chosen file:

```bash
terraform -chdir=infra/terraform plan \
  -var-file=environments/dev.tfvars \
  -var=readings_yaml_path=readings.example.yaml \
  -out=dev-readings.tfplan
# Review the exact environment and data changes before applying.
terraform -chdir=infra/terraform apply dev-readings.tfplan
```

The operator needs GetItem, PutItem and DeleteItem on the readings table to manage its content; the runtime role deliberately has no write access.

The filename is relative to the Terraform root after `-chdir` (absolute paths also work). Replace the example path with your own file. `readings_yaml_path` defaults to null: provisioning a table does not silently publish example text. Persist the chosen path in the environment's reviewed variable file or supply it on every plan. Plan/apply remains manual; app builds do not import content.

Each date becomes an `aws_dynamodb_table_item.reading` resource. Editing a date updates it; removing an entry (or removing the file selection) plans deletion of previously managed rows. Keep the complete desired list in the selected file. Terraform state and saved plans contain the full editorial text. Do not place private shares, credentials or personal journal entries in this file. Saved shares retain their original reading snapshots even if a source row is edited or removed.

## Runtime configuration

| Setting                    | Meaning                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `READINGS_SOURCE=sample`   | Default local-development mode; the existing fictional sample remains visibly labeled.                  |
| `READINGS_SOURCE=dynamodb` | Explicit deployed mode; missing or invalid configuration fails rather than falling back to sample text. |
| `READINGS_TABLE_NAME`      | Required in DynamoDB mode, supplied by Terraform's runtime output.                                      |
| `DYNAMODB_REGION`          | Table region; `AWS_REGION` is a runtime fallback.                                                       |

Use the shared `node --import tsx scripts/prepare-runtime-env.ts` command before the application build, preserving the deployment's existing stable session-secret delivery. Upload content **before** enabling deployed reading mode. No permanent AWS keys are copied into the application. Changes to source/table/region require restart/redeployment.

## Reader timezone and daily rollover

Browsers do not reliably send a timezone in normal request headers. The first server render defaults to `America/Chicago`. The page explicitly obtains the browser's timezone through `Intl.DateTimeFormat().resolvedOptions().timeZone`, stores it in the nonsecret `reading-time-zone` preference cookie, and requests the appropriate reading if its local date differs. The server validates the preference; invalid cookies fall back to Central Time. Later renders use the remembered preference. It provides no authentication or ownership.

The page checks for a date change every minute and when the window regains focus. It does not send a request when the local calendar date is unchanged. Calendar selection uses Intl timezone rules, including DST and leap years. An already open page picks up a changed operating-system timezone on reload. A first visit near a date boundary may briefly show Central Time's reading before local selection finishes; saving is disabled while that lookup is pending.

No reading is published for a selected date: show an unavailable state, preserve the draft, and offer retry. Drafting and recording remain independent of reading availability; saving requires a reading.

## Process-local cache

A process-global cache is shared by server rendering and API routes within each Node instance. It retains up to 16 date entries for five minutes, including missing-date results, and coalesces concurrent lookups. Database failures are not cached. Cache entries are detached before returning them, so a caller cannot mutate a later response. New local dates select different cache keys immediately.

This is an in-memory cache, not browser storage, disk persistence or a distributed cache. Each replica/cold start performs its own lookup. Corrections and newly published missing dates can take up to five minutes to appear on a new request. Restarting instances also clears their caches. An open page keeps its displayed reading until rollover or an explicit retry; it does not poll for same-day editorial edits.

## Saved snapshots and revisions

The client sends its displayed `readingDate` and `readingId` with the text. The server looks up the date and validates the content revision; it never accepts reading text, ownership or authoritative metadata from the client. IDs for deployed readings include a hash of the date/title/body. Saving after midnight still uses the displayed date.

If an editorial correction changed that revision, save returns 409 `READING_CHANGED`, leaves the draft intact, refreshes the reading and asks the person to review before saving again. There is no automatic resubmission. A missing reading returns 503 `READING_UNAVAILABLE`. Existing text-only API clients remain supported and select the current reading using the remembered timezone (Central Time by default); clients should send both fields to bind a displayed revision.

After saving, the complete reading snapshot lives in the share. Later cache expiration, edits or source deletion cannot rewrite it. Existing private ownership and seven-day public-link expiration are unchanged.

## Verification

Default tests cover timezone selection, DST/leap days, concurrent caching, expiry/eviction, missing dates, failures, revision conflicts and immutable snapshots. DynamoDB Local tests exercise the separate date-keyed table and HTTP reads/saves, including a single database read across concurrent requests. Terraform mock tests cover the date key, read-only runtime permissions, YAML items and invalid dates. Browser tests cover timezone preference, rollover, missing content, retry and preserved drafts after editorial corrections. No live content library, production apply or live AWS verification is implied.
