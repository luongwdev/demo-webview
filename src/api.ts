import * as ExpoCrypto from 'expo-crypto';
import { hmacSha256Hex } from './crypto';
import { BaseApiResponse, ExchangeTokenData, GenQrData, GenerateCodeData, LoginData, RegistrationFields } from './types';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

const REQUEST_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Khong ket noi duoc toi ${url} sau ${timeoutMs / 1000}s. Kiem tra: dien thoai va may tinh cung WiFi, Base URL dung IP LAN cua may tinh (khong phai localhost), backend dang chay, firewall khong chan port.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(
  url: string,
  rawBody: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<BaseApiResponse<T>> {
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: rawBody,
    },
    timeoutMs
  );
  const text = await res.text();
  if (res.status === 401) {
    throw new Error(`HTTP 401 - xac thuc that bai: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as BaseApiResponse<T>;
  } catch {
    throw new Error(`HTTP ${res.status} - non-JSON response: ${text.slice(0, 300)}`);
  }
}

function registrationBody(fields: RegistrationFields): string {
  return JSON.stringify({ cccd: fields.cccd, email: fields.email, phone: fields.phone, sessionId: fields.sessionId });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function login(baseUrl: string, username: string, password: string): Promise<BaseApiResponse<LoginData>> {
  return postJson<LoginData>(`${normalizeBaseUrl(baseUrl)}/api/authenticate`, JSON.stringify({ username, password }), {});
}

export async function generateCode(baseUrl: string, token: string, fields: RegistrationFields): Promise<BaseApiResponse<GenerateCodeData>> {
  return postJson<GenerateCodeData>(
    `${normalizeBaseUrl(baseUrl)}/api/webview/registration/generate-code`,
    registrationBody(fields),
    bearer(token)
  );
}

export async function exchangeToken(baseUrl: string, code: string): Promise<BaseApiResponse<ExchangeTokenData>> {
  return postJson<ExchangeTokenData>(`${normalizeBaseUrl(baseUrl)}/api/webview/registration/exchange-token`, JSON.stringify({ code }), {});
}

export async function genQr(baseUrl: string, token: string, fields: RegistrationFields): Promise<BaseApiResponse<GenQrData>> {
  return postJson<GenQrData>(`${normalizeBaseUrl(baseUrl)}/api/webview/registration/gen-qr`, registrationBody(fields), bearer(token));
}

const FACE_MATCHING_TIMEOUT_MS = 60000;

export async function sendFileForOpenSessionIdWithHmac(
  baseUrl: string,
  apiKey: string,
  secretKey: string,
  number: string,
  faceImg: string
): Promise<BaseApiResponse<string>> {
  const path = '/api/face-matching-data/send-file-for-open-session-id';
  const rawBody = JSON.stringify({ faceImg, number });
  const timestamp = vietnamTimestamp(new Date());
  const nonce = ExpoCrypto.randomUUID();
  const dataToSign = ['POST', path, timestamp, nonce, rawBody].join('\n');
  const signature = hmacSha256Hex(dataToSign, secretKey);
  return postJson<string>(
    `${normalizeBaseUrl(baseUrl)}${path}`,
    rawBody,
    { 'X-API-KEY': apiKey, 'X-SIGNATURE': signature, 'X-TIME-STAMP': timestamp, 'X-NONCE': nonce },
    FACE_MATCHING_TIMEOUT_MS
  );
}

export function vietnamTimestamp(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    vn.getUTCFullYear() +
    pad(vn.getUTCMonth() + 1) +
    pad(vn.getUTCDate()) +
    pad(vn.getUTCHours()) +
    pad(vn.getUTCMinutes()) +
    pad(vn.getUTCSeconds())
  );
}
