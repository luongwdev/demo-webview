import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { exchangeToken, generateCode, genQr, login, sendFileForOpenSessionIdWithHmac } from './src/api';
import { decodeJwtPayload } from './src/crypto';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from './src/storage';
import { AppConfig, BridgeMessage, CertIssueResultMessage, GenQrData, LogEntry, RegistrationFields } from './src/types';
import { extractQueryParam } from './src/url';
import WebviewInitModal, { RedirectResult } from './src/WebviewInitModal';
import CertFlowWebviewModal, { CERT_ISSUE_RESULT_TYPE } from './src/CertFlowWebviewModal';

let logCounter = 0;

export default function App() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showConfig, setShowConfig] = useState(true);

  const [busy, setBusy] = useState(false);
  const [agentToken, setAgentToken] = useState<string | null>(null);
  const [webviewCode, setWebviewCode] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [decodedPayload, setDecodedPayload] = useState<Record<string, unknown> | null>(null);
  const [qrData, setQrData] = useState<GenQrData | null>(null);

  const [webviewVisible, setWebviewVisible] = useState(false);
  const [webviewUrl, setWebviewUrl] = useState<string | null>(null);

  const [certFlowVisible, setCertFlowVisible] = useState(false);
  const [certFlowUrl, setCertFlowUrl] = useState<string | null>(null);
  const [certResult, setCertResult] = useState<CertIssueResultMessage | null>(null);

  const [faceImageUri, setFaceImageUri] = useState<string | null>(null);
  const [openSessionToken, setOpenSessionToken] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    loadConfig().then((c) => {
      setConfig(c);
      setConfigLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (configLoaded) {
      saveConfig(config);
    }
  }, [config, configLoaded]);

  function addLog(title: string, detail: unknown, level: LogEntry['level'] = 'info') {
    logCounter += 1;
    const entry: LogEntry = {
      id: `${Date.now()}-${logCounter}`,
      time: new Date().toLocaleTimeString(),
      title,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2),
      level,
    };
    setLogs((prev) => [entry, ...prev].slice(0, 300));
  }

  function updateField<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function currentFields(): RegistrationFields {
    return {
      email: config.registerEmail,
      cccd: config.registerCccd,
      phone: config.registerPhone,
      sessionId: config.sessionId,
    };
  }

  async function runStep(label: string, action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      addLog(`${label} - loi`, err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleLogin() {
    return runStep('0. Dang nhap dai ly', async () => {
      const res = await login(config.baseUrl, config.agentUsername, config.agentPassword);
      if (res.status !== 1 || !res.data?.token) {
        throw new Error(`dang nhap that bai: ${res.msg} (${res.errorCode})`);
      }
      setAgentToken(res.data.token);
      addLog('0. Dang nhap dai ly thanh cong - da co Bearer token', { username: config.agentUsername, userId: res.data.userId }, 'success');
    });
  }

  function requireAgentToken(step: string): string | null {
    if (!agentToken) {
      addLog(step, 'Chua co token dai ly - hay chay buoc 0 (Dang nhap) truoc', 'error');
      return null;
    }
    return agentToken;
  }

  function handleGenerateCode() {
    const token = requireAgentToken('1. Generate Code');
    if (!token) {
      return;
    }
    return runStep('Generate Code', async () => {
      const res = await generateCode(config.baseUrl, token, currentFields());
      if (res.status !== 1 || !res.data) {
        throw new Error(`generate-code that bai: ${res.msg} (${res.errorCode})`);
      }
      setWebviewCode(res.data.webviewCode);
      setAccessToken(null);
      setDecodedPayload(null);
      console.log('[Generate Code] SUCCESS:', {
        webviewCode: res.data.webviewCode,
        data: res.data,
      });
      addLog('1. Generate Code thanh cong (Bearer token)', res.data, 'success');
    });
  }

  function openWebviewForCode() {
    if (!webviewCode) {
      addLog('2. Mo Webview', 'Chua co webviewCode - hay chay buoc 1 truoc', 'error');
      return;
    }
    const url = `${config.baseUrl.replace(/\/$/, '')}/api/webview/registration/init?code=${encodeURIComponent(
      webviewCode
    )}`;
    setWebviewUrl(url);
    setWebviewVisible(true);
    addLog('2. Mo Webview', { url }, 'info');
  }

  function openWebviewForQr() {
    if (!qrData) {
      addLog('Mo Webview tu QR', 'Chua co QR - hay sinh QR truoc', 'error');
      return;
    }
    const code = extractQueryParam(qrData.webviewUrl, 'code');
    if (!code) {
      addLog('Mo Webview tu QR', `Khong tim thay tham so code trong webviewUrl: ${qrData.webviewUrl}`, 'error');
      return;
    }
    const url = `${config.baseUrl.replace(/\/$/, '')}/api/webview/registration/init?code=${encodeURIComponent(
      code
    )}`;
    setWebviewUrl(url);
    setWebviewVisible(true);
    addLog(
      'Mo Webview tu QR',
      'webviewUrl tra ve tro toi ekyc.url (domain public), da tach lai "code" va ghep vao baseUrl dang cau hinh de test dung backend local.',
      'info'
    );
  }

  function handleWebviewCaptured(result: RedirectResult) {
    setWebviewVisible(false);
    addLog('Init redirect bat duoc', result, 'info');
    if (result.error) {
      addLog('Init tra ve loi', result.error, 'error');
      return;
    }
    if (!result.code) {
      addLog('Init', 'Khong bat duoc code/error tu redirect', 'error');
      return;
    }
    runStep('Exchange Token', async () => {
      const res = await exchangeToken(config.baseUrl, result.code as string);
      if (res.status !== 1 || !res.data) {
        throw new Error(`exchange-token that bai: ${res.msg} (${res.errorCode})`);
      }
      setAccessToken(res.data.access_token);
      addLog('3. Exchange Token thanh cong', res.data, 'success');
      try {
        const payload = decodeJwtPayload(res.data.access_token);
        setDecodedPayload(payload);
        addLog('Decode JWT payload', payload, 'info');
      } catch (err) {
        addLog('Decode JWT payload - loi', err instanceof Error ? err.message : String(err), 'error');
      }
    });
  }

  function openCertFlow() {
    if (!webviewCode) {
      addLog('5. Luong dang ky CTS', 'Chua co webviewCode - hay chay buoc 1 truoc', 'error');
      return;
    }
    const url = `${config.baseUrl.replace(/\/$/, '')}/webview/registration/init?code=${webviewCode}`;
    setCertResult(null);
    setCertFlowUrl(url);
    setCertFlowVisible(true);
    addLog(
      '5. Mo luong dang ky CTS (webview that)',
      {
        url,
        mode: config.sessionId.trim() ? 'VERIFICATION (co sessionId -> tiep tuc ho so cu)' : 'REGISTRATION (dang ky moi)',
        dangCho: `event ${CERT_ISSUE_RESULT_TYPE} tu webview`,
      },
      'info'
    );
  }

  function handleBridgeMessage(message: BridgeMessage) {
    console.log(`[mobile nhan] kenh=${message.channel ?? '-'} type=${message.type}`, message.raw);
    if (message.type === CERT_ISSUE_RESULT_TYPE) {
      return;
    }
    addLog(`Event tu webview: ${message.type}`, message, 'info');
  }

  function handleWebDebug(kind: string, payload: unknown, href: string) {
    const isError = /error|rejection|warn/.test(kind);
    console.log(`[web:${kind}]`, href, typeof payload === 'string' ? payload : JSON.stringify(payload));
    addLog(`[web] ${kind}`, { href, payload }, isError ? 'error' : 'info');
  }

  function handleCertIssueResult(message: CertIssueResultMessage) {
    setCertResult(message);
    if (message.status) {
      addLog('CAP CTS THANH CONG - nhan duoc event tu webview', message, 'success');
    } else {
      addLog(`CAP CTS THAT BAI [${message.data?.errorCode ?? '-'}]`, message, 'error');
    }
  }

  function handleCertFlowClose(reason: string) {
    setCertFlowVisible(false);
    addLog('Dong webview luong dang ky CTS', reason, 'info');
  }

  async function handleSendFaceWithHmac() {
    if (!config.testBaseUrl.trim() || !config.testApiKey.trim() || !config.testSecretKey.trim()) {
      addLog('6. send-file-for-open-session-id', 'Chua nhap Base URL test / apiKey test / secretKey test trong muc Cau hinh', 'error');
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      addLog('6. send-file-for-open-session-id', 'Chua cap quyen camera cho app', 'error');
      return;
    }
    const picked = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: ImagePicker.CameraType.front,
      base64: true,
      quality: 0.6,
    });
    if (picked.canceled || !picked.assets[0]?.base64) {
      addLog('6. send-file-for-open-session-id', 'Da huy chup anh', 'info');
      return;
    }
    const asset = picked.assets[0];
    setFaceImageUri(asset.uri);
    setOpenSessionToken(null);

    await runStep('6. send-file-for-open-session-id (HMAC)', async () => {
      addLog(
        '6. Goi send-file-for-open-session-id bang HMAC (khong gui Bearer)',
        { server: config.testBaseUrl, number: config.registerCccd, faceImgLength: asset.base64!.length },
        'info'
      );
      const res = await sendFileForOpenSessionIdWithHmac(
        config.testBaseUrl,
        config.testApiKey,
        config.testSecretKey,
        config.registerCccd,
        asset.base64!
      );
      if (res.status !== 1 || !res.data) {
        throw new Error(`send-file-for-open-session-id that bai: ${res.msg} (${res.errorCode})`);
      }
      setOpenSessionToken(res.data);
      addLog('6. send-file-for-open-session-id thanh cong - nhan token khach hang', { token: res.data }, 'success');
      try {
        addLog('Decode JWT payload (token khach hang)', decodeJwtPayload(res.data), 'info');
      } catch (err) {
        addLog('Decode JWT payload - loi', err instanceof Error ? err.message : String(err), 'error');
      }
    });
  }

  function handleGenQr() {
    const token = requireAgentToken('3. Gen QR');
    if (!token) {
      return;
    }
    return runStep('Gen QR', async () => {
      const res = await genQr(config.baseUrl, token, currentFields());
      if (res.status !== 1 || !res.data) {
        throw new Error(`gen-qr that bai: ${res.msg} (${res.errorCode})`);
      }
      setQrData(res.data);
      addLog(
        '3. Gen QR thanh cong (Bearer token)',
        { createdTime: res.data.createdTime, webviewUrl: res.data.webviewUrl },
        'success'
      );
    });
  }

  function resetFlow() {
    setAgentToken(null);
    setWebviewCode(null);
    setAccessToken(null);
    setDecodedPayload(null);
    setQrData(null);
    setCertResult(null);
    setFaceImageUri(null);
    setOpenSessionToken(null);
    setLogs([]);
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <Text style={styles.header}>Demo Webview Registration V3</Text>
        <Text style={styles.subHeader}>
          Dong vai dai ly tich hop: buoc 0-5 dung Bearer token (dang nhap dai ly), chi buoc 6 dung HMAC v2
        </Text>

        <SectionToggle title="Cau hinh" expanded={showConfig} onToggle={() => setShowConfig((v) => !v)} />
        {showConfig && (
          <View style={styles.card}>
            <Field
              label="Base URL backend (vi du http://192.168.1.100:8080)"
              value={config.baseUrl}
              onChangeText={(v) => updateField('baseUrl', v)}
              autoCapitalize="none"
            />
            <Field
              label="Username dai ly (buoc 0 - lay token)"
              value={config.agentUsername}
              onChangeText={(v) => updateField('agentUsername', v)}
              autoCapitalize="none"
            />
            <PasswordField
              label="Password dai ly"
              value={config.agentPassword}
              onChangeText={(v) => updateField('agentPassword', v)}
            />
            <Text style={styles.hint}>
              Tai khoan dai ly phai co apiKey+secretKey trong DB VA type khac "Tai khoan thuong" (0), neu khong
              generate-code tra loi API_KEY_NOT_CONFIGURED / ACCOUNT_NOT_INTEGRATION_TYPE.
            </Text>

            <Text style={styles.cardTitle}>HMAC v2 (chi dung cho buoc 6)</Text>
            <Field
              label="Base URL server test"
              value={config.testBaseUrl}
              onChangeText={(v) => updateField('testBaseUrl', v)}
              autoCapitalize="none"
            />
            <Field
              label="apiKey dai ly tren server test"
              value={config.testApiKey}
              onChangeText={(v) => updateField('testApiKey', v)}
              autoCapitalize="none"
            />
            <Field
              label="secretKey dai ly tren server test"
              value={config.testSecretKey}
              onChangeText={(v) => updateField('testSecretKey', v)}
              autoCapitalize="none"
            />
          </View>
        )}

        <SectionToggle title="Thong tin dang ky" expanded onToggle={() => {}} disabled />
        <View style={styles.card}>
          <Field label="email" value={config.registerEmail} onChangeText={(v) => updateField('registerEmail', v)} autoCapitalize="none" />
          <Field label="cccd" value={config.registerCccd} onChangeText={(v) => updateField('registerCccd', v)} keyboardType="number-pad" />
          <Field label="phone" value={config.registerPhone} onChangeText={(v) => updateField('registerPhone', v)} keyboardType="phone-pad" />
          <Field label="sessionId" value={config.sessionId} onChangeText={(v) => updateField('sessionId', v)} autoCapitalize="none" />
        </View>

        <View style={styles.card}>
          <StepButton label="0) Dang nhap dai ly (lay Bearer token)" onPress={handleLogin} disabled={busy} done={!!agentToken} />
          <StepButton label="1) Generate Code" onPress={handleGenerateCode} disabled={busy || !agentToken} done={!!webviewCode} />
          <StepButton
            label="2) Mo Webview (init -> exchange-token)"
            onPress={openWebviewForCode}
            disabled={busy || !webviewCode}
            done={!!accessToken}
          />
          <StepButton label="3) Gen QR" onPress={handleGenQr} disabled={busy || !agentToken} done={!!qrData} />
          <StepButton label="4) Mo Webview tu QR" onPress={openWebviewForQr} disabled={busy || !qrData} />
          <StepButton
            label="5) Mo luong dang ky CTS (webview that, cho event)"
            onPress={openCertFlow}
            disabled={busy || !webviewCode}
            done={!!certResult?.status}
          />
          <Text style={styles.hint}>
            Buoc 5 can webviewCode tu buoc 1. De trong sessionId de dang ky moi. Buoc chup khuon mat can camera nen
            Base URL phai la https (vd UAT hoac ngrok), http qua IP LAN se khong mo duoc camera.
          </Text>

          <StepButton
            label="6) Chup mat + goi send-file-for-open-session-id (HMAC)"
            onPress={handleSendFaceWithHmac}
            disabled={busy}
            done={!!openSessionToken}
          />
          <Text style={styles.hint}>
            Buoc 6 goi thang toi server test (khong qua backend local), khong can token: ky body bang
            apiKey/secretKey theo HMAC v2 (X-API-KEY, X-SIGNATURE, X-TIME-STAMP, X-NONCE), dung cccd o muc "Thong tin dang ky". Tai khoan dai ly phai la PARTNER_INTEGRATION hoac VERIBOX_INTEGRATION.
          </Text>

          <TouchableOpacity style={styles.resetButton} onPress={resetFlow} disabled={busy}>
            <Text style={styles.resetText}>Reset luong test</Text>
          </TouchableOpacity>
        </View>

        {busy && <ActivityIndicator style={styles.spinner} size="large" />}

        {webviewCode && (
          <View style={styles.card}>
            <CopyableValue label="webviewCode" value={webviewCode} />
          </View>
        )}

        {qrData && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>QR sinh ra ({qrData.createdTime})</Text>
            <Image source={{ uri: qrData.qrImage }} style={styles.qrImage} resizeMode="contain" />
          </View>
        )}

        {certResult && (
          <View style={[styles.card, certResult.status ? styles.certSuccess : styles.certError]}>
            <Text style={styles.cardTitle}>
              {certResult.status
                ? 'Ket qua cap CTS: THANH CONG'
                : `Ket qua cap CTS: THAT BAI [${certResult.data?.errorCode ?? '-'}]`}
            </Text>
            {!certResult.status && <Text style={styles.mono}>{certResult.reason}</Text>}
            <Text style={styles.fieldLabel}>
              Kenh: {certResult.channel ?? '-'} | type: {certResult.type}
            </Text>
            {certResult.raw ? <CopyableValue label="Du lieu web gui sang (nguyen van)" value={certResult.raw} /> : null}
            {certResult.data?.sessionId ? <CopyableValue label="sessionId" value={certResult.data.sessionId} /> : null}
            {certResult.data?.serial ? <CopyableValue label="serial" value={certResult.data.serial} /> : null}
            {certResult.data?.credentialID ? <CopyableValue label="credentialID" value={certResult.data.credentialID} /> : null}
            {certResult.data?.accessToken ? <CopyableValue label="accessToken (CTS)" value={certResult.data.accessToken} /> : null}
            {certResult.data?.certRaw ? <CopyableValue label="certRaw" value={certResult.data.certRaw} /> : null}
          </View>
        )}

        {(faceImageUri || openSessionToken) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ket qua buoc 6 (HMAC)</Text>
            {faceImageUri && <Image source={{ uri: faceImageUri }} style={styles.facePreview} resizeMode="cover" />}
            {openSessionToken && <CopyableValue label="token khach hang (open session)" value={openSessionToken} />}
          </View>
        )}

        {accessToken && (
          <View style={styles.card}>
            <CopyableValue label="access_token" value={accessToken} />
          </View>
        )}

        {decodedPayload && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payload access_token (JWT)</Text>
            <Text style={styles.mono}>{JSON.stringify(decodedPayload, null, 2)}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log ({logs.length})</Text>
          {logs.map((log) => (
            <View key={log.id} style={[styles.logEntry, styles[`log_${log.level}`]]}>
              <Text style={styles.logTitle}>
                [{log.time}] {log.title}
              </Text>
              <Text style={styles.logDetail}>{log.detail}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <CertFlowWebviewModal
        visible={certFlowVisible}
        url={certFlowUrl}
        onBridgeMessage={handleBridgeMessage}
        onWebDebug={handleWebDebug}
        onCertIssueResult={handleCertIssueResult}
        onClose={handleCertFlowClose}
      />

      <WebviewInitModal
        visible={webviewVisible}
        url={webviewUrl}
        onCaptured={handleWebviewCaptured}
        onClose={() => setWebviewVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View>
      <View style={styles.copyableHeader}>
        <Text style={styles.cardTitle}>{label}</Text>
        <TouchableOpacity onPress={handleCopy} style={styles.copyButton}>
          <Text style={styles.copyButtonText}>{copied ? 'Da copy' : 'Copy'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.mono}>{value}</Text>
    </View>
  );
}

function SectionToggle({
  title,
  expanded,
  onToggle,
  disabled,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.sectionToggle} onPress={onToggle} disabled={disabled}>
      <Text style={styles.sectionToggleText}>
        {disabled ? '' : expanded ? '▼ ' : '▶ '}
        {title}
      </Text>
    </TouchableOpacity>
  );
}

function PasswordField(props: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        autoCapitalize="none"
        secureTextEntry
      />
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'number-pad' | 'phone-pad';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        keyboardType={props.keyboardType ?? 'default'}
      />
    </View>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
  done,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  done?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.stepButton, disabled ? styles.stepButtonDisabled : done ? styles.stepButtonDone : null]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.stepButtonText}>
        {done ? '✓ ' : ''}
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#111827' },
  content: { padding: 16, paddingTop: 56, paddingBottom: 48 },
  header: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subHeader: { color: '#9ca3af', fontSize: 13, marginBottom: 16 },
  sectionToggle: { paddingVertical: 8 },
  sectionToggleText: { color: '#e5e7eb', fontWeight: '600', fontSize: 14 },
  card: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  cardTitle: { color: '#e5e7eb', fontWeight: '600', marginBottom: 8 },
  copyableHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  copyButton: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#2563eb', borderRadius: 6 },
  copyButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  fieldWrap: { marginBottom: 10 },
  fieldLabel: { color: '#9ca3af', fontSize: 12, marginBottom: 4 },
  hint: { color: '#fbbf24', fontSize: 11, marginTop: 2 },
  input: {
    backgroundColor: '#111827',
    color: '#fff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  stepButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  stepButtonDisabled: { backgroundColor: '#374151' },
  stepButtonDone: { backgroundColor: '#16a34a' },
  stepButtonText: { color: '#fff', fontWeight: '600' },
  resetButton: { marginTop: 14, alignItems: 'center' },
  resetText: { color: '#f87171', fontWeight: '600' },
  spinner: { marginBottom: 16 },
  facePreview: { width: 120, height: 160, borderRadius: 8, marginBottom: 10 },
  qrImage: { width: '100%', height: 260, backgroundColor: '#fff', borderRadius: 8 },
  mono: { color: '#e5e7eb', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  logEntry: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 10 },
  log_info: { borderLeftColor: '#3b82f6' },
  log_success: { borderLeftColor: '#22c55e' },
  log_error: { borderLeftColor: '#ef4444' },
  certSuccess: { borderWidth: 1, borderColor: '#22c55e' },
  certError: { borderWidth: 1, borderColor: '#ef4444' },
  logTitle: { color: '#e5e7eb', fontWeight: '600', fontSize: 12, marginBottom: 2 },
  logDetail: { color: '#9ca3af', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
