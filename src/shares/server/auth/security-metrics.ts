import 'server-only';
/** Fixed dimensions only: never include owner IDs, URLs, text, cookies or upstream errors. */
export function securityMetric(
  operation: string,
  result: 'allowed' | 'limited' | 'unavailable' | 'provider_error'
) {
  if (process.env.NODE_ENV !== 'production') return;
  console.info(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'Doorknob/Security',
            Dimensions: [['Operation', 'Result']],
            Metrics: [{ Name: 'Requests', Unit: 'Count' }]
          }
        ]
      },
      Operation: operation,
      Result: result,
      Requests: 1
    })
  );
}
