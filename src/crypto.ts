import CryptoJS from 'crypto-js';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function hmacSha256Hex(data: string, secret: string): string {
  return CryptoJS.HmacSHA256(data, secret).toString(CryptoJS.enc.Hex);
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT: expected 3 dot-separated segments');
  }
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const words = CryptoJS.enc.Base64.parse(base64);
  const json = CryptoJS.enc.Utf8.stringify(words);
  return JSON.parse(json);
}
