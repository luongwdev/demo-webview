import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppConfig } from './types';

const STORAGE_KEY = 'demo-webview-config-v1';

export const DEFAULT_CONFIG: AppConfig = {
  baseUrl: 'http://192.168.1.35:8080',
  agentUsername: 'demobvnhi',
  agentPassword: '',
  testBaseUrl: 'https://testid.easyca.vn',
  testApiKey: 'f97d631287d5038b231d07a09c45ebbecdf5759f49c728e31ac11229ed1a605b',
  testSecretKey: '1',
  registerEmail: 'luonghd@softdreams.vn',
  registerCccd: '025205009758',
  registerPhone: '0392096054',
  sessionId: 'a5b31799-b77a-4373-9144-410aac3fe6dd',
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CONFIG;
    }
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Persisting the demo config is a convenience only; ignore storage failures.
  }
}
