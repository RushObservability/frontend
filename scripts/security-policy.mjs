const remoteFontHosts = ['fonts.googleapis.com', 'fonts.gstatic.com']

// Scan complete HTML/config/header text, not a URL allowlist. Deliberately reject
// any reference containing these names, including subdomains and URL paths.
export function containsRemoteFontReference(text) {
  const normalized = text.toLowerCase()
  return remoteFontHosts.some(host => normalized.includes(host))
}
