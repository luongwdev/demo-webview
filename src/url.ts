export function extractQueryParam(url: string, key: string): string | undefined {
  const match = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}
