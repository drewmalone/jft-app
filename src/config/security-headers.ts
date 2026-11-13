/** Keep the candidate policy report-only until provider/browser flows have been observed. */
export function securityHeaders(hosted: boolean) {
  const baseline = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), geolocation=(), microphone=(self)'
    },
    { key: 'Content-Security-Policy', value: baseline },
    {
      key: 'Content-Security-Policy-Report-Only',
      value:
        "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.openai.com https://soniox.com https://*.soniox.com wss://*.soniox.com; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'; report-uri /api/csp-report; " +
        baseline
    },
    ...(hosted
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
      : [])
  ];
}
