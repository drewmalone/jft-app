import { ZodError } from 'zod';

const hints = new Map<unknown, string>([
  [
    'ENOENT',
    'File not found: check READINGS_LOCAL_PATH relative to the app working directory.'
  ],
  ['EACCES', 'The configured readings file is not readable.'],
  ['EISDIR', 'READINGS_LOCAL_PATH points to a directory, not a YAML file.'],
  ['Invalid reading YAML.', 'Malformed YAML or duplicate YAML keys.'],
  ['Duplicate reading date.', 'Duplicate reading date in the catalog.'],
  [
    'Reading catalog exceeds the size limit.',
    'Catalog exceeds the 10 MiB limit.'
  ]
]);
/** Plain text survives development log forwarding; never include reading values, credentials or raw SDK errors. */
export function readingFailureMessage(cause: unknown): string {
  if (cause instanceof ZodError) {
    const fields = cause.issues.slice(0, 10).map((issue) => {
      const expected =
        issue.code === 'invalid_type'
          ? `expected ${issue.expected}`
          : issue.code;
      return `${issue.path.join('.') || '(root)'}: ${expected}`;
    });
    return `Invalid configuration or catalog. Expected a YAML list with MM-DD date, title, quote, source and body. ${fields.join('; ')}`;
  }
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? cause.code
      : undefined;
  const message = cause instanceof Error ? cause.message : '';
  return `Catalog load failed. ${hints.get(code) ?? hints.get(message) ?? 'Source request failed: check local file access or S3 bucket, key, region and role permissions.'}`;
}
