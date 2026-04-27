(function attachRuntimeUpdate(root, factory) {
  root.MultiPageRuntimeUpdate = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createRuntimeUpdateModule() {
  const STORAGE_KEY_PENDING_UPDATE = 'multipage-runtime-update-pending-v1';
  const DEFAULT_RELOAD_DELAY_MS = 1200;

  function getRuntimeLastErrorMessage(runtime) {
    try {
      return String(runtime?.lastError?.message || '').trim();
    } catch {
      return '';
    }
  }

  function getManifestInfo(runtime) {
    let manifest = {};
    try {
      manifest = runtime?.getManifest?.() || {};
    } catch {
      manifest = {};
    }

    return {
      extensionId: String(runtime?.id || '').trim(),
      name: String(manifest?.name || '').trim(),
      version: String(manifest?.version || '').trim(),
      versionName: String(manifest?.version_name || '').trim(),
      updateUrl: String(manifest?.update_url || '').trim(),
    };
  }

  function normalizeUpdateCheckResult(statusOrResult, details = {}) {
    if (statusOrResult && typeof statusOrResult === 'object' && !Array.isArray(statusOrResult)) {
      const status = String(statusOrResult.status || '').trim();
      const resultDetails = statusOrResult.details && typeof statusOrResult.details === 'object'
        ? statusOrResult.details
        : {};
      return {
        status,
        version: String(statusOrResult.version || resultDetails.version || '').trim(),
        details: resultDetails,
      };
    }

    const normalizedDetails = details && typeof details === 'object' ? details : {};
    return {
      status: String(statusOrResult || '').trim(),
      version: String(normalizedDetails.version || '').trim(),
      details: normalizedDetails,
    };
  }

  function isMissingUpdateUrlError(message) {
    return /update[_\s-]*url|no\s+update|not\s+hosted|not\s+from\s+.*web\s+store|update\s+check\s+failed/i.test(String(message || ''));
  }

  function buildManualUpdateMessage(errorMessage, manifestInfo) {
    const baseMessage = errorMessage
      ? `浏览器更新检查失败：${errorMessage}`
      : '浏览器更新通道未发现可直接安装的版本。';

    if (!manifestInfo?.updateUrl || isMissingUpdateUrlError(errorMessage)) {
      return `${baseMessage} 当前扩展没有可用 update_url，或正在用“加载已解压的扩展程序”运行；这种安装方式不能从 GitHub 自动替换扩展包。请从 GitHub Release 下载新版，或安装带 update_url 的 CRX 后再使用一键更新。`;
    }

    return `${baseMessage} 请确认 GitHub Release 已上传更新清单和同签名 CRX，或手动打开发布页下载。`;
  }

  function requestUpdateCheck(runtime) {
    return new Promise((resolve, reject) => {
      if (!runtime?.requestUpdateCheck) {
        reject(new Error('当前浏览器不支持 chrome.runtime.requestUpdateCheck。'));
        return;
      }

      let settled = false;
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      try {
        const maybePromise = runtime.requestUpdateCheck((statusOrResult, details) => {
          const lastErrorMessage = getRuntimeLastErrorMessage(runtime);
          if (lastErrorMessage) {
            finishReject(new Error(lastErrorMessage));
            return;
          }
          finishResolve(normalizeUpdateCheckResult(statusOrResult, details));
        });

        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise
            .then((result) => finishResolve(normalizeUpdateCheckResult(result)))
            .catch((error) => finishReject(error));
        }
      } catch (error) {
        finishReject(error);
      }
    });
  }

  function createRuntimeUpdateManager(deps = {}) {
    const chromeApi = deps.chrome || (typeof chrome !== 'undefined' ? chrome : null);
    const runtime = chromeApi?.runtime || null;
    const storage = chromeApi?.storage?.local || null;
    const setTimer = deps.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    const clearTimer = deps.clearTimeout || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    const now = deps.now || (() => Date.now());
    let reloadTimer = null;

    function scheduleReload(delayMs = DEFAULT_RELOAD_DELAY_MS) {
      if (!runtime?.reload || typeof setTimer !== 'function') {
        return false;
      }
      if (reloadTimer && typeof clearTimer === 'function') {
        clearTimer(reloadTimer);
      }
      reloadTimer = setTimer(() => {
        reloadTimer = null;
        try {
          runtime.reload();
        } catch {
          // Ignore reload failures; the user can still reload manually.
        }
      }, Math.max(0, Number(delayMs) || DEFAULT_RELOAD_DELAY_MS));
      return true;
    }

    async function rememberPendingUpdate(details = {}) {
      if (!storage?.set) {
        return;
      }
      try {
        await storage.set({
          [STORAGE_KEY_PENDING_UPDATE]: {
            ...details,
            checkedAt: now(),
          },
        });
      } catch {
        // Ignore storage failures; they should not block updating.
      }
    }

    async function requestImmediateUpdate(options = {}) {
      const manifestInfo = getManifestInfo(runtime);
      const shouldReload = options.reload !== false;
      const reloadDelayMs = Number.isFinite(Number(options.reloadDelayMs))
        ? Number(options.reloadDelayMs)
        : DEFAULT_RELOAD_DELAY_MS;

      if (!runtime?.requestUpdateCheck) {
        return {
          ok: false,
          status: 'unsupported',
          manifest: manifestInfo,
          willReload: false,
          message: '当前浏览器不支持一键更新。请打开 GitHub Release 手动下载新版。',
        };
      }

      try {
        const result = await requestUpdateCheck(runtime);
        const status = result.status || 'unknown';
        const version = result.version || '';

        if (status === 'update_available') {
          await rememberPendingUpdate({
            status,
            version,
            reason: options.reason || 'manual',
            manifest: manifestInfo,
          });
          const willReload = shouldReload && scheduleReload(reloadDelayMs);
          return {
            ok: true,
            status,
            version,
            manifest: manifestInfo,
            willReload,
            message: willReload
              ? `检测到新版本${version ? ` ${version}` : ''}，扩展将自动重载并应用更新。`
              : `检测到新版本${version ? ` ${version}` : ''}，请稍后重新加载扩展以应用更新。`,
          };
        }

        if (status === 'no_update') {
          return {
            ok: true,
            status,
            version,
            manifest: manifestInfo,
            willReload: false,
            message: buildManualUpdateMessage('', manifestInfo),
          };
        }

        if (status === 'throttled') {
          return {
            ok: true,
            status,
            version,
            manifest: manifestInfo,
            willReload: false,
            message: '浏览器限制了频繁更新检查，请稍后再试；也可以先打开 GitHub Release 手动下载新版。',
          };
        }

        return {
          ok: true,
          status,
          version,
          manifest: manifestInfo,
          willReload: false,
          message: buildManualUpdateMessage(`未知更新状态：${status}`, manifestInfo),
        };
      } catch (error) {
        const errorMessage = error?.message || String(error || '更新检查失败');
        return {
          ok: false,
          status: 'manual_required',
          manifest: manifestInfo,
          willReload: false,
          message: buildManualUpdateMessage(errorMessage, manifestInfo),
        };
      }
    }

    if (runtime?.onUpdateAvailable?.addListener) {
      try {
        runtime.onUpdateAvailable.addListener((details = {}) => {
          const payload = {
            status: 'update_available',
            version: String(details?.version || '').trim(),
            manifest: getManifestInfo(runtime),
            reason: 'browser_event',
          };
          rememberPendingUpdate(payload).catch(() => {});
          if (runtime?.sendMessage) {
            runtime.sendMessage({
              type: 'EXTENSION_UPDATE_AVAILABLE',
              source: 'background',
              payload,
            }).catch(() => {});
          }
        });
      } catch {
        // Ignore listener registration failures.
      }
    }

    return {
      getManifestInfo: () => getManifestInfo(runtime),
      requestImmediateUpdate,
      scheduleReload,
    };
  }

  return {
    createRuntimeUpdateManager,
    normalizeUpdateCheckResult,
  };
});
