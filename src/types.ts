export interface RegistrationFields {
  email: string;
  cccd: string;
  phone: string;
  sessionId: string;
}

export interface BaseApiResponse<T> {
  status: number;
  data: T | null;
  msg?: string;
  errorCode?: string;
}

export interface GenerateCodeData {
  webviewCode: string;
}

export interface ExchangeTokenData {
  email: string;
  cccd: string;
  phone: string;
  sessionId: string;
  access_token: string;
}

export interface GenQrData {
  createdTime: string;
  webviewUrl: string;
  qrImage: string;
}

export interface LoginData {
  userId?: number;
  token: string;
}

export interface AppConfig {
  baseUrl: string;
  agentUsername: string;
  agentPassword: string;
  testBaseUrl: string;
  testApiKey: string;
  testSecretKey: string;
  registerEmail: string;
  registerCccd: string;
  registerPhone: string;
  sessionId: string;
}

export interface LogEntry {
  id: string;
  time: string;
  title: string;
  detail: string;
  level: 'info' | 'success' | 'error';
}

export interface BridgeMessage {
  type: string;
  channel?: string;
  raw?: string;
  status?: boolean;
  reason?: string;
  data?: unknown;
}

export type CertIssueErrorCode = 'MISSING_SESSION' | 'SESSION_EXPIRED' | 'API_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'PENDING';

export interface CertIssueResultData {
  sessionId?: string;
  serial?: string;
  credentialID?: string;
  certRaw?: string;
  accessToken?: string;
  errorCode?: CertIssueErrorCode;
}

export interface CertIssueResultMessage extends BridgeMessage {
  status: boolean;
  data?: CertIssueResultData;
}
