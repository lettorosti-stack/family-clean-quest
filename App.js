import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';

import { isFirebaseConfigured } from './src/firebaseConfig';
import previewHtml from './src/previewHtml';

const extra = Constants.expoConfig?.extra ?? {};
const diagnosticMode = String(extra.diagnosticMode ?? 'preview');
const minimalWebViewHtml = '<html><body><h1>WebView работает</h1></body></html>';
const FAMILY_CODE_STORAGE_KEY = 'family-clean-quest-family-code-v1';
const DEVICE_ID_STORAGE_KEY = 'family-clean-quest-device-id-v1';

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
  var RECORD_GROUPS = ['completed', 'purchases', 'customTasks', 'passwordResetRequests'];

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

  function mergeTombstones(localValue, remoteValue) {
    var merged = {};
    RECORD_GROUPS.forEach(function (group) {
      merged[group] = Object.assign({}, (remoteValue && remoteValue[group]) || {});
      var localGroup = (localValue && localValue[group]) || {};
      Object.keys(localGroup).forEach(function (id) {
        var currentTime = Date.parse(merged[group][id] || '') || 0;
        var nextTime = Date.parse(localGroup[id] || '') || 0;
        if (nextTime >= currentTime) merged[group][id] = localGroup[id];
      });
    });
    return merged;
  }

  function mergeRecords(localRecords, remoteRecords, tombstones) {
    var byId = {};
    (remoteRecords || []).concat(localRecords || []).forEach(function (record) {
      if (!record || record.id == null) return;
      var id = String(record.id);
      var current = byId[id];
      var currentTime = Date.parse((current && (current.updatedAt || current.createdAt || current.date)) || '') || 0;
      var nextTime = Date.parse(record.updatedAt || record.createdAt || record.date || '') || 0;
      if (!current || nextTime >= currentTime) byId[id] = record;
    });
    return Object.keys(byId)
      .filter(function (id) {
        var record = byId[id];
        var recordTimestamp = Date.parse(record.updatedAt || record.createdAt || record.date || '') || 0;
        var deletedTimestamp = Date.parse((tombstones && tombstones[id]) || '') || 0;
        return recordTimestamp > deletedTimestamp;
      })
      .map(function (id) { return byId[id]; });
  }

  function mergeAvatarState(current, remote, replaceSharedState) {
    if (replaceSharedState) {
      return {
        avatars: Object.assign({}, remote.avatars || {}),
        avatarUpdatedAt: Object.assign({}, remote.avatarUpdatedAt || {})
      };
    }
    var avatars = Object.assign({}, current.avatars || {});
    var avatarUpdatedAt = Object.assign({}, current.avatarUpdatedAt || {});
    var remoteAvatars = remote.avatars || {};
    var remoteTimes = remote.avatarUpdatedAt || {};
    Object.keys(remoteAvatars).forEach(function (memberId) {
      var localTime = Date.parse(avatarUpdatedAt[memberId] || '') || 0;
      var remoteTime = Date.parse(remoteTimes[memberId] || '') || 0;
      if (!(memberId in avatars) || remoteTime >= localTime) {
        avatars[memberId] = remoteAvatars[memberId];
        if (remoteTimes[memberId]) avatarUpdatedAt[memberId] = remoteTimes[memberId];
      }
    });
    return { avatars: avatars, avatarUpdatedAt: avatarUpdatedAt };
  }

  function applyRemoteState(remote, replaceSharedState) {
    var current = readState() || {};
    var tombstones = mergeTombstones(replaceSharedState ? {} : current.syncTombstones, remote.syncTombstones);
    var avatarState = mergeAvatarState(current, remote, replaceSharedState);
    var next = Object.assign({}, current, {
      avatars: avatarState.avatars,
      avatarUpdatedAt: avatarState.avatarUpdatedAt,
      completed: mergeRecords(replaceSharedState ? [] : current.completed, remote.completed, tombstones.completed),
      purchases: mergeRecords(replaceSharedState ? [] : current.purchases, remote.purchases, tombstones.purchases),
      customTasks: mergeRecords(replaceSharedState ? [] : current.customTasks, remote.customTasks, tombstones.customTasks),
      passwordResetRequests: mergeRecords(replaceSharedState ? [] : current.passwordResetRequests, remote.passwordResetRequests, tombstones.passwordResetRequests),
      syncTombstones: tombstones,
      cloudFolderUrl: remote.cloudFolderUrl || current.cloudFolderUrl || '',
      active: current.active || null,
      loginChoice: current.loginChoice || 'mom',
      tab: current.tab || 'home',
      selectedDate: current.selectedDate || new Date().toISOString().slice(0, 10),
      selectedZone: current.selectedZone || null
    });
    writeState(next);
    if (typeof window.render === 'function') window.render();
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'remoteApplied' }));
    }
  }

  var originalSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (key === STORAGE_KEY) {
      setTimeout(function () { postState('localStorage'); }, 0);
    }
  };

  function handleNativeMessage(event) {
    try {
      var message = JSON.parse(event.data);
      if (message && message.type === 'remoteFamilyState' && message.value) {
        applyRemoteState(message.value, Boolean(message.replace));
      }
      if (message && message.type === 'syncConfig' && message.value) {
        window.__familySyncConfig = message.value;
        if (typeof window.setFamilySyncConfig === 'function') window.setFamilySyncConfig(message.value);
      }
      if (message && message.type === 'syncStatus' && message.text && typeof window.showToast === 'function') {
        window.showToast(message.text);
      }
    } catch (error) {}
  }

  window.addEventListener('message', handleNativeMessage);
  document.addEventListener('message', handleNativeMessage);

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
  const lastRemoteStateRef = useRef(null);
  const applyingRemoteRef = useRef(false);
  const joiningFamilyRef = useRef(false);
  const replaceNextRemoteRef = useRef(false);
  const syncRef = useRef(getFirebaseSync());
  const [loadError, setLoadError] = useState(null);
  const [diagnostics, setDiagnostics] = useState([]);
  const [htmlFileUri, setHtmlFileUri] = useState(null);
  const [familyCode, setFamilyCode] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState('disconnected');

  const webViewSource = useMemo(
    () => {
      if (diagnosticMode === 'webview-minimal') {
        return {
          html: minimalWebViewHtml,
          baseUrl: 'https://localhost',
        };
      }
      if (!htmlFileUri) return null;
      return { uri: htmlFileUri };
    },
    [htmlFileUri],
  );

  const pushDiagnostic = useCallback((message) => {
    setDiagnostics((items) => [...items.slice(-7), `${new Date().toLocaleTimeString()}: ${message}`]);
  }, []);

  const applyRemoteFamilyState = useCallback((remoteState, replace = false) => {
    if (!remoteState || !syncRef.current) return;
    const shared = syncRef.current.toSharedFamilyState(remoteState, familyCode);
    lastRemoteStateRef.current = { value: shared, replace };
    applyingRemoteRef.current = true;
    webViewRef.current?.postMessage(JSON.stringify({
      type: 'remoteFamilyState',
      value: shared,
      replace,
    }));
    setSyncStatus('connected');
    setTimeout(() => {
      applyingRemoteRef.current = false;
      joiningFamilyRef.current = false;
    }, 900);
  }, [familyCode]);

  useEffect(() => {
    let active = true;
    Promise.all([
      AsyncStorage.getItem(FAMILY_CODE_STORAGE_KEY),
      AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY),
    ])
      .then(async ([storedFamilyCode, storedDeviceId]) => {
        if (!active) return;
        const nextDeviceId = storedDeviceId || `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        if (!storedDeviceId) await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, nextDeviceId);
        setDeviceId(nextDeviceId);
        setFamilyCode(syncRef.current?.normalizeFamilyCode(storedFamilyCode) || '');
        setSyncReady(true);
      })
      .catch((error) => {
        pushDiagnostic(`Sync settings load: ${error?.message ?? error}`);
        setSyncReady(true);
      });
    return () => {
      active = false;
    };
  }, [pushDiagnostic]);

  useEffect(() => {
    webViewRef.current?.postMessage(JSON.stringify({
      type: 'syncConfig',
      value: {
        configured: isFirebaseConfigured(),
        familyCode,
        status: syncStatus,
      },
    }));
  }, [familyCode, syncStatus]);

  useEffect(() => {
    if (diagnosticMode === 'webview-minimal' || diagnosticMode === 'rn-root') return undefined;

    let cancelled = false;
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      const text = 'HTML file write failed: cache directory is not available';
      pushDiagnostic(text);
      setLoadError(text);
      return undefined;
    }

    const htmlPath = `${baseDirectory}family-clean-quest-preview.html`;

    FileSystem.writeAsStringAsync(htmlPath, previewHtml)
      .then(() => {
        if (!cancelled) {
          setHtmlFileUri(htmlPath);
          pushDiagnostic(`HTML file ready: ${htmlPath}`);
        }
      })
      .catch((error) => {
        const text = `HTML file write failed: ${error?.message ?? error}`;
        pushDiagnostic(text);
        setLoadError(text);
      });

    return () => {
      cancelled = true;
    };
  }, [pushDiagnostic]);

  useEffect(() => {
    if (!syncReady || !isFirebaseConfigured() || !syncRef.current || !familyCode) return undefined;
    setSyncStatus('connecting');
    return syncRef.current.subscribeFamilyState(
      familyCode,
      (remoteState) => {
        if (!remoteState) {
          setSyncStatus('waiting');
          return;
        }
        applyRemoteFamilyState(remoteState, replaceNextRemoteRef.current);
        replaceNextRemoteRef.current = false;
      },
      (error) => {
        setSyncStatus('error');
        pushDiagnostic(`Firebase subscribe: ${error?.message ?? error}`);
        console.warn('Family sync subscribe failed', error);
      },
    );
  }, [applyRemoteFamilyState, familyCode, pushDiagnostic, syncReady]);

  useEffect(() => {
    if (!syncReady || !isFirebaseConfigured() || !syncRef.current || !familyCode) return undefined;
    let cancelled = false;
    const refreshFromCloud = () => {
      syncRef.current.getFamilyState(familyCode)
        .then((remoteState) => {
          if (!cancelled) applyRemoteFamilyState(remoteState, false);
        })
        .catch((error) => {
          if (!cancelled) pushDiagnostic(`Firebase polling refresh: ${error?.message ?? error}`);
        });
    };
    refreshFromCloud();
    const interval = setInterval(refreshFromCloud, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [applyRemoteFamilyState, familyCode, pushDiagnostic, syncReady]);

  useEffect(() => {
    if (!isFirebaseConfigured() || !syncRef.current) return undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && familyCode) {
        syncRef.current.getFamilyState(familyCode)
          .then((remoteState) => applyRemoteFamilyState(remoteState, false))
          .catch((error) => {
            pushDiagnostic(`Firebase foreground refresh: ${error?.message ?? error}`);
          });
        return;
      }
      if (nextState !== 'background' && nextState !== 'inactive') return;
      if (!lastSharedStateRef.current) return;
      if (!familyCode) return;
      syncRef.current.publishFamilyState(familyCode, lastSharedStateRef.current, {
        memberId: lastSharedStateRef.current.active,
        deviceId,
      })
        .catch((error) => {
          pushDiagnostic(`Firebase background publish: ${error?.message ?? error}`);
          console.warn('Family sync background publish failed', error);
        });
    });
    return () => subscription.remove();
  }, [applyRemoteFamilyState, deviceId, familyCode, pushDiagnostic]);

  const handleSyncCommand = useCallback(async (message) => {
    if (!isFirebaseConfigured() || !syncRef.current) throw new Error('Firebase не настроен');
    const action = message.action;
    if (action === 'disconnect') {
      await AsyncStorage.removeItem(FAMILY_CODE_STORAGE_KEY);
      lastRemoteStateRef.current = null;
      replaceNextRemoteRef.current = false;
      setFamilyCode('');
      setSyncStatus('disconnected');
      joiningFamilyRef.current = false;
      lastPublishedRef.current = '';
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'syncStatus',
        text: 'Устройство отключено от семьи',
      }));
      return;
    }

    if (action === 'create') {
      setSyncStatus('connecting');
      let code = '';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = syncRef.current.generateFamilyCode();
        if (!(await syncRef.current.familyExists(candidate))) {
          code = candidate;
          break;
        }
      }
      if (!code) throw new Error('Не удалось создать уникальный код семьи. Попробуйте ещё раз');
      await syncRef.current.publishFamilyState(code, message.value || {}, {
        memberId: message.value?.active,
        deviceId,
      });
      await AsyncStorage.setItem(FAMILY_CODE_STORAGE_KEY, code);
      setFamilyCode(code);
      setSyncStatus('connected');
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'syncStatus',
        text: `Семья создана. Код: ${code}`,
      }));
      return;
    }

    if (action === 'join') {
      const code = syncRef.current.normalizeFamilyCode(message.code);
      if (!syncRef.current.isValidFamilyCode(code)) throw new Error('Введите 12 символов кода семьи');
      setSyncStatus('connecting');
      if (!(await syncRef.current.familyExists(code))) throw new Error('Семья с таким кодом не найдена');
      lastRemoteStateRef.current = null;
      joiningFamilyRef.current = true;
      replaceNextRemoteRef.current = true;
      await AsyncStorage.setItem(FAMILY_CODE_STORAGE_KEY, code);
      setFamilyCode(code);
      webViewRef.current?.postMessage(JSON.stringify({
        type: 'syncStatus',
        text: 'Устройство подключается к семье…',
      }));
      return;
    }

    throw new Error('Неизвестная команда синхронизации');
  }, [deviceId]);

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

    if (message?.type === 'remoteApplied') {
      applyingRemoteRef.current = false;
      joiningFamilyRef.current = false;
      return;
    }

    if (message?.type === 'syncCommand') {
      handleSyncCommand(message).catch((error) => {
        setSyncStatus('error');
        pushDiagnostic(`Sync command: ${error?.message ?? error}`);
        webViewRef.current?.postMessage(JSON.stringify({
          type: 'syncStatus',
          text: error?.message || 'Ошибка подключения синхронизации',
        }));
      });
      return;
    }

    const isStateMessage = message?.type === 'state';
    const isForceSync = message?.type === 'forceSync';
    if ((!isStateMessage && !isForceSync) || !message.value || applyingRemoteRef.current || joiningFamilyRef.current) return;
    if (!isFirebaseConfigured() || !syncRef.current) {
      if (isForceSync) {
        webViewRef.current?.postMessage(JSON.stringify({
          type: 'syncStatus',
          text: 'Облачная синхронизация не настроена',
        }));
      }
      return;
    }

    if (!familyCode) {
      if (isForceSync) {
        webViewRef.current?.postMessage(JSON.stringify({
          type: 'syncStatus',
          text: 'Сначала создайте семью или подключитесь по коду',
        }));
      }
      return;
    }

    const shared = syncRef.current.toSharedFamilyState(message.value, familyCode);
    lastSharedStateRef.current = shared;
    const serialized = JSON.stringify(shared);
    if (serialized === lastPublishedRef.current && !isForceSync) return;
    lastPublishedRef.current = serialized;

    syncRef.current.publishFamilyState(familyCode, shared, {
      memberId: message.value.active,
      deviceId,
    })
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
  }, [deviceId, familyCode, handleSyncCommand, pushDiagnostic]);

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
        ) : !webViewSource ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Загрузка интерфейса...</Text>
            <Text style={styles.errorText}>Подготавливаем экран приложения.</Text>
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
              webViewRef.current?.postMessage(JSON.stringify({
                type: 'syncConfig',
                value: {
                  configured: isFirebaseConfigured(),
                  familyCode,
                  status: syncStatus,
                },
              }));
              if (lastRemoteStateRef.current) {
                webViewRef.current?.postMessage(JSON.stringify({
                  type: 'remoteFamilyState',
                  ...lastRemoteStateRef.current,
                }));
              }
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

