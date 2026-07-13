import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { WebView } from 'react-native-webview';

import previewHtml from './src/previewHtml';

const extra = Constants.expoConfig?.extra ?? {};
const diagnosticMode = String(extra.diagnosticMode ?? 'preview');
const minimalWebViewHtml = '<html><body><h1>WebView работает</h1></body></html>';

function isFirebaseConfigured() {
  const apiKey = extra.firebaseApiKey;
  return Boolean(apiKey && !String(apiKey).startsWith('YOUR_'));
}

function getFirebaseSync() {
  if (!isFirebaseConfigured()) return null;
  try {
    return require('./src/firebaseSync');
  } catch (error) {
    console.warn('Firebase sync module failed to load', error);
    return null;
  }
}

const bridgeScript = `
(function () {
  if (window.__familyCleanBridgeInstalled) return true;
  window.__familyCleanBridgeInstalled = true;
  var STORAGE_KEY = 'cleanQuestPreview';

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function writeState(nextState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }

  function postState(reason) {
    var value = readState();
    if (!value || !window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'state',
      reason: reason || 'change',
      value: value
    }));
  }

  function mergeRecords(localRecords, remoteRecords) {
    var byId = {};
    (remoteRecords || []).concat(localRecords || []).forEach(function (record) {
      if (!record || record.id == null) return;
      var id = String(record.id);
      var current = byId[id];
      var currentTime = Date.parse((current && (current.updatedAt || current.createdAt || current.date)) || '') || 0;
      var nextTime = Date.parse(record.updatedAt || record.createdAt || record.date || '') || 0;
      if (!current || nextTime >= currentTime) byId[id] = record;
    });
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function applyRemoteState(remote) {
    var current = readState() || {};
    var next = Object.assign({}, current, {
      avatars: Object.assign({}, current.avatars || {}, remote.avatars || {}),
      completed: mergeRecords(current.completed, remote.completed),
      purchases: mergeRecords(current.purchases, remote.purchases),
      customTasks: mergeRecords(current.customTasks, remote.customTasks),
      passwords: Object.assign({}, current.passwords || {}, remote.passwords || {}),
      passwordResetRequests: mergeRecords(current.passwordResetRequests, remote.passwordResetRequests),
      cloudFolderUrl: current.cloudFolderUrl || remote.cloudFolderUrl || '',
      recoveryWord: current.recoveryWord || remote.recoveryWord || '',
      active: current.active || null,
      loginChoice: current.loginChoice || 'mom',
      tab: current.tab || 'home',
      selectedDate: current.selectedDate || new Date().toISOString().slice(0, 10),
      selectedZone: current.selectedZone || null
    });
    writeState(next);
    if (typeof window.render === 'function') window.render();
  }

  var originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (key === STORAGE_KEY) {
      setTimeout(function () { postState('localStorage'); }, 0);
    }
  };

  window.addEventListener('message', function (event) {
    try {
      var message = JSON.parse(event.data);
      if (message && message.type === 'remoteFamilyState' && message.value) {
        applyRemoteState(message.value);
      }
      if (message && message.type === 'syncStatus' && message.text && typeof window.showToast === 'function') {
        window.showToast(message.text);
      }
    } catch (error) {}
  });

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { postState('ready'); }, 400);
  });
  setTimeout(function () { postState('ready'); }, 800);
  return true;
})();
true;
`;

const diagnosticsScript = `
(function () {
  if (window.__familyCleanDiagnosticsInstalled) return true;
  window.__familyCleanDiagnosticsInstalled = true;

  function send(type, value) {
    try {
      if (!window.ReactNativeWebView) return;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: type,
        value: value == null ? '' : String(value)
      }));
    } catch (error) {}
  }

  window.onerror = function (message, source, line, column, error) {
    send('htmlError', [
      message || 'Unknown HTML error',
      source || '',
      line || '',
      column || '',
      error && error.stack ? error.stack : ''
    ].join(' | '));
    return false;
  };

  window.onunhandledrejection = function (event) {
    var reason = event && event.reason;
    send('htmlUnhandledRejection', reason && reason.stack ? reason.stack : (reason || 'Unhandled promise rejection'));
  };

  var originalConsoleError = console.error;
  console.error = function () {
    var args = Array.prototype.slice.call(arguments).map(function (item) {
      if (item && item.stack) return item.stack;
      if (typeof item === 'object') {
        try { return JSON.stringify(item); } catch (error) { return String(item); }
      }
      return String(item);
    });
    send('consoleError', args.join(' '));
    if (originalConsoleError) originalConsoleError.apply(console, arguments);
  };

  document.addEventListener('DOMContentLoaded', function () {
    send('htmlReady', 'DOMContentLoaded');
  });

  return true;
})();
true;
`;

export default function App() {
  const webViewRef = useRef(null);
  const lastPublishedRef = useRef('');
  const lastSharedStateRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const syncRef = useRef(getFirebaseSync());
  const [loadError, setLoadError] = useState(null);
  const [diagnostics, setDiagnostics] = useState([]);

  const webViewSource = useMemo(
    () => ({
      html: diagnosticMode === 'webview-minimal' ? minimalWebViewHtml : previewHtml,
      baseUrl: 'https://localhost',
    }),
    [],
  );

  const pushDiagnostic = useCallback((message) => {
    setDiagnostics((items) => [...items.slice(-7), `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured() || !syncRef.current) return undefined;

    return syncRef.current.subscribeFamilyState(
      (remoteState) => {
        const shared = syncRef.current.toSharedFamilyState(remoteState);
        applyingRemoteRef.current = true;
        webViewRef.current?.postMessage(JSON.stringify({
          type: 'remoteFamilyState',
          value: shared,
        }));
        setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 600);
      },
      (error) => {
        pushDiagnostic(`Firebase subscribe: ${error?.message ?? error}`);
        console.warn('Family sync subscribe failed', error);
      },
    );
  }, [pushDiagnostic]);

  useEffect(() => {
    if (!isFirebaseConfigured() || !syncRef.current) return undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'background' && nextState !== 'inactive') return;
      if (!lastSharedStateRef.current) return;
      syncRef.current.publishFamilyState(lastSharedStateRef.current, { memberId: lastSharedStateRef.current.active })
        .catch((error) => {
          pushDiagnostic(`Firebase background publish: ${error?.message ?? error}`);
          console.warn('Family sync background publish failed', error);
        });
    });
    return () => subscription.remove();
  }, [pushDiagnostic]);

  const handleMessage = useCallback((event) => {
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch (error) {
      pushDiagnostic(`WebView message parse failed: ${event.nativeEvent.data}`);
      console.warn('WebView message parse failed', error);
      return;
    }

    if (['htmlError', 'htmlUnhandledRejection', 'consoleError'].includes(message?.type)) {
      const text = `${message.type}: ${message.value}`;
      pushDiagnostic(text);
      setLoadError(text);
      return;
    }

    if (['htmlReady', 'diagnostic'].includes(message?.type)) {
      pushDiagnostic(`${message.type}: ${message.value}`);
      return;
    }

    const isStateMessage = message?.type === 'state';
    const isForceSync = message?.type === 'forceSync';
    if ((!isStateMessage && !isForceSync) || !message.value || applyingRemoteRef.current) return;
    if (!isFirebaseConfigured() || !syncRef.current) {
      if (isForceSync) {
        webViewRef.current?.postMessage(JSON.stringify({
          type: 'syncStatus',
          text: 'Облачная синхронизация не настроена',
        }));
      }
      return;
    }

    const shared = syncRef.current.toSharedFamilyState(message.value);
    lastSharedStateRef.current = shared;
    const serialized = JSON.stringify(shared);
    if (serialized === lastPublishedRef.current && !isForceSync) return;
    lastPublishedRef.current = serialized;

    syncRef.current.publishFamilyState(shared, { memberId: message.value.active })
      .then(() => {
        if (isForceSync) {
          webViewRef.current?.postMessage(JSON.stringify({
            type: 'syncStatus',
            text: 'Синхронизация выполнена',
          }));
        }
      })
      .catch((error) => {
        lastPublishedRef.current = '';
        pushDiagnostic(`Firebase publish: ${error?.message ?? error}`);
        console.warn('Family sync publish failed', error);
        if (isForceSync) {
          webViewRef.current?.postMessage(JSON.stringify({
            type: 'syncStatus',
            text: 'Ошибка синхронизации. Проверьте интернет и настройки Firebase.',
          }));
        }
      });
  }, [pushDiagnostic]);

  if (diagnosticMode === 'rn-root') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.errorBox}>
          <StatusBar style="dark" />
          <Text style={styles.errorTitle}>Приложение запущено</Text>
          <Text style={styles.errorText}>React Native-корень работает.</Text>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        {loadError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Не удалось открыть приложение</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            {diagnostics.map((item) => (
              <Text key={item} style={styles.diagnosticText}>{item}</Text>
            ))}
          </View>
        ) : (
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={webViewSource}
            injectedJavaScriptBeforeContentLoaded={diagnosticsScript}
            injectedJavaScript={bridgeScript}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess
            allowUniversalAccessFromFileURLs
            mixedContentMode="always"
            setSupportMultipleWindows={false}
            onMessage={handleMessage}
            onLoadStart={() => pushDiagnostic('WebView onLoadStart')}
            onLoadEnd={() => {
              pushDiagnostic('WebView onLoadEnd');
              if (!isFirebaseConfigured()) {
                webViewRef.current?.postMessage(JSON.stringify({
                  type: 'syncStatus',
                  text: 'Облачная синхронизация не настроена',
                }));
              }
            }}
            onError={(event) => {
              const text = event.nativeEvent.description || 'WebView onError';
              pushDiagnostic(`WebView onError: ${text}`);
              setLoadError(text);
            }}
            onHttpError={(event) => {
              pushDiagnostic(`WebView onHttpError: ${event.nativeEvent.statusCode} ${event.nativeEvent.description || ''}`);
            }}
            onRenderProcessGone={(event) => {
              const text = `WebView render process gone: ${JSON.stringify(event.nativeEvent)}`;
              pushDiagnostic(text);
              setLoadError(text);
            }}
            renderError={(errorName) => (
              <View style={styles.errorBox}>
                <Text style={styles.errorTitle}>Ошибка WebView</Text>
                <Text style={styles.errorText}>{errorName}</Text>
              </View>
            )}
            style={styles.webView}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  webView: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  errorTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
  },
  diagnosticText: {
    color: '#334155',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
  },
});

