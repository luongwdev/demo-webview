import React, { useEffect, useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { extractQueryParam } from './url';

export interface RedirectResult {
  code?: string;
  error?: string;
}

interface Props {
  visible: boolean;
  url: string | null;
  onCaptured: (result: RedirectResult) => void;
  onClose: () => void;
}

function extractRedirectResult(url: string): RedirectResult | null {
  if (!url.includes('/registration/site')) {
    return null;
  }
  return { code: extractQueryParam(url, 'code'), error: extractQueryParam(url, 'error') };
}

export default function WebviewInitModal({ visible, url, onCaptured, onClose }: Props) {
  const handledRef = useRef(false);

  useEffect(() => {
    if (visible) {
      handledRef.current = false;
    }
  }, [visible]);

  if (!url) {
    return null;
  }

  const tryHandle = (navUrl: string): boolean => {
    if (handledRef.current) {
      return true;
    }
    const result = extractRedirectResult(navUrl);
    if (result) {
      handledRef.current = true;
      onCaptured(result);
      return true;
    }
    return false;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>Webview đăng ký (mô phỏng trang đối tác)</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Đóng</Text>
        </TouchableOpacity>
      </View>
      <WebView
        source={{ uri: url }}
        onShouldStartLoadWithRequest={(request) => !tryHandle(request.url)}
        onNavigationStateChange={(navState: WebViewNavigation) => {
          tryHandle(navState.url);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#1f2937',
  },
  title: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    marginRight: 12,
  },
  closeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#374151',
    borderRadius: 6,
  },
  closeText: {
    color: '#fff',
    fontWeight: '600',
  },
});
