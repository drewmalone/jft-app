# Daily Just for Today readings

Readings form one YAML catalog, loaded from either a local file or a private S3 object. DynamoDB stores saved shares and their reading snapshots. The application loads the catalog lazily on its first reading request and caches it in memory; builds never download content.

## Content and publication

The included [YAML example](../infra/terraform/readings.example.yaml) contains **fictional examples**, not a real reading library. Supply your own licensed editorial content:

```yaml
- date: '2028-12-03'
  title: A FICTIONAL TITLE
  quote: A fictional quotation for today.
  source: Fictional collection, p. 1
  body: |-
    A fictional first paragraph.

    A fictional second paragraph.
```

Quote full ISO calendar dates, including explicit leap-day entries. Duplicate or invalid dates and blank text are rejected. Titles allow 500 characters, quotations 5,000, sources 1,000, and bodies 50,000. All five fields are required in new publications. The file is a top-level list, without a `readings:` wrapper. The catalog allows at most 3,660 entries and 10 MiB of UTF-8 YAML. Plain text and line breaks are preserved; HTML is not interpreted. Missing dates remain unavailable. The runtime setting `READINGS_SAMPLE=true` labels fictional content on Today; this metadata is outside the YAML. It never supplies a fallback for missing dates. Quotation and source display above the body and form part of the revision hash and saved snapshot. Older saved shares without those fields remain readable.

For local development, set `READINGS_SOURCE=local` and `READINGS_LOCAL_PATH` to the file. The default path is `infra/terraform/readings.example.yaml`, relative to the application working directory. The example only covers its listed dates, so add fictional entries for dates you want to exercise locally.

For S3, Terraform provisions a private encrypted, versioned bucket and uploads the complete catalog as `just-for-today.yaml`. Set the required `readings_yaml_path` in the environment's reviewed tfvars file; paths are relative to the Terraform root, or absolute. The checked-in environment files explicitly select the fictional example: replace that path before deploying real content. Keeping the path in configuration means a later routine plan cannot accidentally omit a one-off upload flag.

After selecting and initializing the correct backend/account in the [infrastructure runbook](../infra/terraform/README.md):

```bash
terraform -chdir=infra/terraform plan -var-file=environments/dev.tfvars -out=dev-readings.tfplan
# Review the environment and object changes, then apply the reviewed plan.
terraform -chdir=infra/terraform apply dev-readings.tfplan
```

Editing the selected file publishes a new object version. Removing entries makes those dates unavailable after refresh. The runtime role has only `s3:GetObject` on this object; Terraform's operator owns publication. Saved shares retain their original snapshots. Content belongs in the YAML file, never private shares, credentials or personal journals. S3 versions retain prior publications until explicitly removed.

## Runtime configuration

| Setting                 | Meaning                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `READINGS_SAMPLE`       | `true` labels fictional content; defaults to `true` for local mode and `false` for S3. Set `false` for a real local catalog. |
| `READINGS_SOURCE=local` | Default; read a local YAML catalog.                                                                                          |
| `READINGS_LOCAL_PATH`   | File path; defaults to the included example.                                                                                 |
| `READINGS_SOURCE=s3`    | Read a private S3 YAML catalog; invalid configuration fails.                                                                 |
| `READINGS_S3_BUCKET`    | Required S3 bucket name.                                                                                                     |
| `READINGS_S3_KEY`       | Object key; defaults to `just-for-today.yaml`.                                                                               |
| `READINGS_REGION`       | S3 region; falls back to `AWS_REGION`. Independent of shares' `DYNAMODB_REGION`.                                             |

Terraform's `runtime_environment` output provides the S3 settings. Use `node --import tsx scripts/prepare-runtime-env.ts` before building, preserving stable session-secret delivery. The AWS SDK uses the compute role; do not copy permanent AWS keys. Changing source/path/bucket/key/region requires restarting the application. Local files must be included in the deployed artifact if local mode is used outside development.

## Cache and failures

One process-global cache is shared by server rendering and API routes within each Node instance. It loads and validates the entire catalog before publishing any change, coalescing concurrent requests across all dates. Requests return detached readings. Subsequent requests revalidate after five minutes; S3 uses `If-None-Match` with the last successfully validated ETag. Local mode rereads the file. No request is needed merely to select another date from the loaded catalog.

A refresh failure retains the last valid catalog and retries on a request after one minute. An initial failure has no fallback, returns unavailable, and is retried on the next request. Thus an outage can keep older content available beyond five minutes. Each replica/cold start loads independently; this is not a distributed cache. No timers or recurring jobs are required. S3 requests have a 15-second deadline and downloads are bounded to the catalog size limit.

## Reader timezone and active drafts

Browsers do not reliably send their timezone in ordinary headers. First server render defaults to `America/Chicago`. The client reads `Intl.DateTimeFormat().resolvedOptions().timeZone`, stores the validated nonsecret `reading-time-zone` preference cookie, and requests its local date when needed. Later server renders use the preference; invalid values fall back to Central Time. The cookie has no ownership or authentication role.

The page checks for a date change every minute and on focus. An empty composer follows the current reading. At rollover the old unpinned reading becomes unavailable while the new date loads, including if the request fails. Existing pins remain usable. Browser requests time out after 15 seconds and are aborted on unmount; a failed request can be retried. The first nonblank typed words or recording start pins the displayed reading to that draft, including its date, revision and sample label. Background rollover does not replace it. Navigation preserves the draft. Clearing an inactive draft or successfully saving releases the pin; stopping a recording with no words also releases it. Drafting and recording work when a reading is unavailable, but saving requires a reading.

The server checks a supplied revision before saving. If editorial content changed, it returns `READING_CHANGED` without writing. The draft keeps its original reading and words while the client refreshes. **Review current reading** deliberately attaches the refreshed current reading to the draft; the person then reviews it and explicitly saves again. If the pinned date was a previous day, this action moves the draft to today's reading. There is no automatic resubmission. Saved shares never follow later content edits.
