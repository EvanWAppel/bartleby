interface BrowserLocation {
  protocol: string;
  host: string;
}

export function resolveCollaborationUrl(location: BrowserLocation, explicitUrl?: string): string {
  if (explicitUrl !== undefined) return explicitUrl;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/collaboration`;
}
