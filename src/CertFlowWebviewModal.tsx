import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewMessageEvent, WebViewNavigation } from 'react-native-webview';
import { BridgeMessage, CertIssueResultMessage } from './types';

export const CERT_ISSUE_RESULT_TYPE = 'easy-ca:cert-issue-result';
export const SEND_CERT_INFO_TYPE = 'easy-ca:send-cert-info';
export const MOBILE_CHANNEL = 'vn.softdreams.easyca/mobile_channel';
export const EXIST_WEBVIEW_TYPE = 'easy-ca:exist-webview';
export const CLOSE_WEBVIEW_TYPE = 'easy-ca:close-webview';
export const BACK_TO_PREVIOUS_SCREEN_TYPE = 'easy-ca:back-to-previous-screen';

const FLUTTER_BRIDGE_SHIM = `
(function () {
  if (window.flutter_inappwebview) { return; }
  window.flutter_inappwebview = {
    callHandler: function (name, message) {
      var payload = typeof message === 'string' ? message : JSON.stringify(message);
      window.ReactNativeWebView.postMessage(JSON.stringify({ __channel: name, payload: payload }));
      return Promise.resolve();
    }
  };
})();
true;
`;

export const WEB_DEBUG_TYPE = '__web-debug';

const WEB_DEBUG_HOOKS = `
(function () {
  if (window.__rnDebugInstalled) { return; }
  window.__rnDebugInstalled = true;
  function send(kind, payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: '${WEB_DEBUG_TYPE}', kind: kind, payload: payload, href: location.href }));
    } catch (e) {}
  }
  function text(args) {
    return Array.prototype.map.call(args, function (a) {
      if (a instanceof Error) { return a.message + ' | ' + (a.stack || ''); }
      if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 800); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ').slice(0, 1500);
  }
  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    console[level] = function () { send('console.' + level, text(arguments)); return original.apply(console, arguments); };
  });
  window.addEventListener('error', function (e) { send('js-error', (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', function (e) { send('promise-rejection', text([e.reason])); });
  ['pushState', 'replaceState'].forEach(function (fn) {
    var original = history[fn];
    history[fn] = function (state, title, url) {
      send('route.' + fn, { from: location.pathname + location.search, to: String(url) });
      return original.apply(history, arguments);
    };
  });
  window.addEventListener('popstate', function () { send('route.popstate', location.pathname + location.search); });
  var open = XMLHttpRequest.prototype.open;
  var sendXhr = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__dbg = method + ' ' + url; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    var startedAt = Date.now();
    xhr.addEventListener('loadend', function () {
      var body = '';
      try { body = (xhr.responseText || '').slice(0, 400); } catch (e) {}
      send(xhr.status >= 200 && xhr.status < 300 ? 'api' : 'api-error', { call: xhr.__dbg, status: xhr.status, ms: Date.now() - startedAt, body: body });
    });
    return sendXhr.apply(this, arguments);
  };
  send('page-start', location.href);
})();
true;
`;

const SEND_BACK_TO_WEB = `
window.postMessage(JSON.stringify({ type: '${BACK_TO_PREVIOUS_SCREEN_TYPE}' }), window.location.origin);
true;
`;

interface Props {
  visible: boolean;
  url: string | null;
  onBridgeMessage: (message: BridgeMessage) => void;
  onWebDebug: (kind: string, payload: unknown, href: string) => void;
  onCertIssueResult: (message: CertIssueResultMessage) => void;
  onClose: (reason: string) => void;
}

function parseBridgeMessage(raw: string): { channel: string | null; message: BridgeMessage } | null {
  try {
    let parsed = JSON.parse(raw);
    let channel: string | null = null;
    let payload = raw;
    if (parsed && typeof parsed.__channel === 'string') {
      channel = parsed.__channel;
      payload = parsed.payload;
      parsed = JSON.parse(payload);
    }
    return parsed && typeof parsed.type === 'string' ? { channel, message: { ...parsed, raw: payload } } : null;
  } catch {
    return null;
  }
}

export default function CertFlowWebviewModal({ visible, url, onBridgeMessage, onWebDebug, onCertIssueResult, onClose }: Props) {
  const webviewRef = useRef<WebView>(null);
  const closedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<CertIssueResultMessage | null>(null);

  useEffect(() => {
    if (visible) {
      closedRef.current = false;
      setBanner(null);
      setLoading(true);
    }
  }, [visible]);

  if (!url) {
    return null;
  }

  const close = (reason: string) => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    onClose(reason);
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    const parsed = parseBridgeMessage(event.nativeEvent.data);
    if (!parsed) {
      return;
    }
    const { channel, message } = parsed;
    if (message.type === WEB_DEBUG_TYPE) {
      const debug = message as BridgeMessage & { kind: string; payload: unknown; href: string };
      onWebDebug(debug.kind, debug.payload, debug.href);
      return;
    }
    onBridgeMessage({ ...message, channel: channel ?? undefined });
    if (message.type === SEND_CERT_INFO_TYPE) {
      const result: CertIssueResultMessage = {
        type: message.type,
        status: true,
        channel: channel ?? undefined,
        raw: message.raw,
        data: message.data as CertIssueResultMessage['data'],
      };
      setBanner(result);
      onCertIssueResult(result);
    } else if (message.type === CERT_ISSUE_RESULT_TYPE) {
      const result = message as CertIssueResultMessage;
      setBanner(result);
      onCertIssueResult(result);
    } else if (message.type === CLOSE_WEBVIEW_TYPE) {
      if (channel === MOBILE_CHANNEL) {
        close(`nhan ${CLOSE_WEBVIEW_TYPE} (data=${JSON.stringify(message.data ?? null)}) qua kenh ${channel}`);
      } else {
        onWebDebug('warn: close-webview SAI KENH, app khong dong', { channel, data: message.data ?? null }, '');
      }
    } else if (message.type === EXIST_WEBVIEW_TYPE) {
      onWebDebug('warn: nhan exist-webview cua V1, app V3 khong dong', { channel, data: message.data ?? null }, '');
    }
  };

  const handleNavigation = (navState: WebViewNavigation) => {
    onWebDebug(`navigation${navState.loading ? ' (loading)' : ''}`, navState.url, navState.url);
    if (navState.url.endsWith('#success') || navState.url.endsWith('#cancel')) {
      onWebDebug('warn: web chi doi hash, app khong dong theo URL', navState.url, navState.url);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => webviewRef.current?.injectJavaScript(SEND_BACK_TO_WEB)}>
      <View style={styles.header}>
        <Text style={styles.title}>Luong dang ky CTS (webview V3)</Text>
        <TouchableOpacity onPress={() => close('nguoi dung bam Dong tren app')} style={styles.closeButton}>
          <Text style={styles.closeText}>Dong</Text>
        </TouchableOpacity>
      </View>

      {banner && (
        <View style={[styles.banner, banner.status ? styles.bannerSuccess : styles.bannerError]}>
          <Text style={styles.bannerText}>
            {banner.status
              ? `App da nhan ${banner.type} qua kenh ${banner.channel ?? '-'}${banner.channel === MOBILE_CHANNEL ? ' (dung kenh)' : ' (SAI KENH)'} - serial ${banner.data?.serial ?? '-'}`
              : `App da nhan event: cap CTS that bai [${banner.data?.errorCode ?? '-'}] ${banner.reason ?? ''}`}
          </Text>
        </View>
      )}

      <View style={styles.flex}>
        <WebView
          ref={webviewRef}
          source={{ uri: url }}
          injectedJavaScriptBeforeContentLoaded={FLUTTER_BRIDGE_SHIM + WEB_DEBUG_HOOKS}
          onMessage={handleMessage}
          onNavigationStateChange={handleNavigation}
          onLoadEnd={() => setLoading(false)}
          onError={(e) => onWebDebug('load-error', e.nativeEvent, e.nativeEvent.url)}
          onHttpError={(e) => onWebDebug('http-error', { status: e.nativeEvent.statusCode, description: e.nativeEvent.description }, e.nativeEvent.url)}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          webviewDebuggingEnabled
        />
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#1f2937',
  },
  title: { color: '#fff', fontSize: 14, flex: 1, marginRight: 12 },
  closeButton: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#374151', borderRadius: 6 },
  closeText: { color: '#fff', fontWeight: '600' },
  banner: { paddingHorizontal: 16, paddingVertical: 10 },
  bannerSuccess: { backgroundColor: '#166534' },
  bannerError: { backgroundColor: '#991b1b' },
  bannerText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
});
