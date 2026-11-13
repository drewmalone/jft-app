/** Application request deadlines; paid cleanup retains its longer existing budget. */
export const requestLimits = {
  browserMs: 15_000,
  cleanupMs: 30_000,
  storageMs: 8_000,
  quotaMs: 8_000,
  cspReportMs: 5_000
} as const;
