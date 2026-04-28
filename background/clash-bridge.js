(function attachBackgroundClashBridge(root, factory) {
  root.MultiPageBackgroundClashBridge = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundClashBridgeModule() {
  const DEFAULT_CONTROLLER_URL = 'http://127.0.0.1:62754';
  const DEFAULT_PROXY_GROUP = 'NODE-SELECT';
  const DEFAULT_EXCLUDE_PATTERN = '香港|hong[ -]?kong|\\bhk\\b|\\bhkg\\b|🇭🇰|DIRECT|REJECT|GLOBAL|自动|故障|负载|轮询|剩余流量|套餐|到期|traffic|expire|subscription|reset';
  const FETCH_TIMEOUT_MS = 8000;

  function normalizeControllerUrl(value = DEFAULT_CONTROLLER_URL) {
    const raw = String(value || '').trim() || DEFAULT_CONTROLLER_URL;
    const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `http://${raw}`;
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return DEFAULT_CONTROLLER_URL;
      }
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return DEFAULT_CONTROLLER_URL;
    }
  }

  function normalizeProxyGroup(value = DEFAULT_PROXY_GROUP) {
    return String(value || '').trim() || DEFAULT_PROXY_GROUP;
  }

  function normalizeExcludePattern(value = DEFAULT_EXCLUDE_PATTERN) {
    return String(value || '').trim() || DEFAULT_EXCLUDE_PATTERN;
  }

  function compileExcludeRegex(pattern) {
    const normalized = normalizeExcludePattern(pattern);
    try {
      return new RegExp(normalized, 'i');
    } catch {
      return new RegExp(DEFAULT_EXCLUDE_PATTERN, 'i');
    }
  }

  function uniqueStrings(items = []) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const value = typeof item === 'string'
        ? item.trim()
        : String(item?.name || '').trim();
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  function isBuiltinProxyName(name = '') {
    return /^(DIRECT|REJECT|GLOBAL)$/i.test(String(name || '').trim());
  }

  function getGroupProxyNames(group = {}) {
    return uniqueStrings(
      Array.isArray(group.all) ? group.all : (
        Array.isArray(group.proxies) ? group.proxies : []
      )
    );
  }

  function getStoredClashProxyNodes(state = {}) {
    if (!Array.isArray(state.proxyNodes)) {
      return [];
    }
    return state.proxyNodes
      .filter((node) => node && typeof node === 'object')
      .map((node) => ({
        ...node,
        id: String(node.id || '').trim(),
        name: String(node.clashName || node.name || '').trim(),
      }))
      .filter((node) => node.name && node.usable !== false && node.clashSupported !== false);
  }

  function pickNextProxyName(proxyNames = [], currentName = '', lastName = '', excludePattern = DEFAULT_EXCLUDE_PATTERN) {
    const allNames = uniqueStrings(proxyNames);
    if (!allNames.length) {
      return '';
    }

    const excludeRegex = compileExcludeRegex(excludePattern);
    const strictCandidates = allNames.filter((name) => (
      !isBuiltinProxyName(name)
      && !excludeRegex.test(name)
    ));
    const candidates = strictCandidates.length > 0
      ? strictCandidates
      : allNames.filter((name) => !isBuiltinProxyName(name));

    if (!candidates.length) {
      return '';
    }

    const current = String(currentName || '').trim();
    const last = String(lastName || '').trim();
    const anchor = candidates.includes(current) ? current : (candidates.includes(last) ? last : '');
    if (!anchor) {
      return candidates[0];
    }

    const index = candidates.indexOf(anchor);
    return candidates[(index + 1) % candidates.length] || candidates[0];
  }

  function createHeaders(secret = '') {
    const headers = {
      Accept: 'application/json',
    };
    const token = String(secret || '').trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }

  function createJsonHeaders(secret = '') {
    return {
      ...createHeaders(secret),
      'Content-Type': 'application/json',
    };
  }

  function createClashBridge(deps = {}) {
    const fetchImpl = deps.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    const AbortControllerImpl = deps.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null);
    const setTimer = deps.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    const clearTimer = deps.clearTimeout || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    const addLog = deps.addLog || (async () => {});
    const getState = deps.getState || (async () => ({}));
    const setState = deps.setState || (async () => {});

    async function fetchJson(url, options = {}) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境不支持 fetch，无法连接 Clash。');
      }

      let controller = null;
      let timeoutId = null;
      const requestOptions = { ...options };
      if (AbortControllerImpl && typeof setTimer === 'function') {
        controller = new AbortControllerImpl();
        requestOptions.signal = controller.signal;
        timeoutId = setTimer(() => controller.abort(), FETCH_TIMEOUT_MS);
      }

      try {
        const response = await fetchImpl(url, requestOptions);
        if (!response?.ok) {
          throw new Error(`Clash API 请求失败：HTTP ${response?.status || 'unknown'}`);
        }
        if (response.status === 204) {
          return null;
        }
        if (typeof response.json === 'function') {
          return await response.json();
        }
        return null;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('Clash API 请求超时。');
        }
        throw error;
      } finally {
        if (timeoutId && typeof clearTimer === 'function') {
          clearTimer(timeoutId);
        }
      }
    }

    async function requestClash(path, options = {}, state = {}) {
      const baseUrl = normalizeControllerUrl(state.clashBridgeControllerUrl);
      return fetchJson(`${baseUrl}${path}`, options);
    }

    async function ensureRuleMode(state = {}) {
      if (state.clashBridgeSetRuleMode === false) {
        return;
      }
      await requestClash('/configs', {
        method: 'PATCH',
        headers: createJsonHeaders(state.clashBridgeSecret),
        body: JSON.stringify({ mode: 'rule' }),
      }, state);
    }

    async function fetchProxyGroup(state = {}) {
      const groupName = normalizeProxyGroup(state.clashBridgeProxyGroup);
      try {
        return await requestClash(`/proxies/${encodeURIComponent(groupName)}`, {
          method: 'GET',
          headers: createHeaders(state.clashBridgeSecret),
        }, state);
      } catch (error) {
        const payload = await requestClash('/proxies', {
          method: 'GET',
          headers: createHeaders(state.clashBridgeSecret),
        }, state);
        const proxyGroup = payload?.proxies?.[groupName];
        if (!proxyGroup) {
          throw error;
        }
        return proxyGroup;
      }
    }

    async function switchProxy(state = {}, proxyName = '') {
      const groupName = normalizeProxyGroup(state.clashBridgeProxyGroup);
      await requestClash(`/proxies/${encodeURIComponent(groupName)}`, {
        method: 'PUT',
        headers: createJsonHeaders(state.clashBridgeSecret),
        body: JSON.stringify({ name: proxyName }),
      }, state);
    }

    async function rotateOnce(options = {}) {
      const state = options.state || await getState();
      if (!state?.clashBridgeEnabled) {
        return { ok: true, skipped: true, reason: 'disabled' };
      }

      const groupName = normalizeProxyGroup(state.clashBridgeProxyGroup);
      await addLog(`Clash 桥接：正在检查本地控制器并准备切换“${groupName}”节点...`, 'info');

      try {
        await ensureRuleMode(state);
      } catch (error) {
        await addLog(`Clash 桥接：切换规则模式失败，将继续尝试切节点：${error.message}`, 'warn');
      }

      const group = await fetchProxyGroup(state);
      const storedNodes = getStoredClashProxyNodes(state);
      const proxyNames = storedNodes.length
        ? storedNodes.map((node) => node.name)
        : getGroupProxyNames(group);
      const currentName = String(group?.now || '').trim();
      const nextName = pickNextProxyName(
        proxyNames,
        currentName,
        state.clashBridgeLastProxyName,
        state.clashBridgeExcludePattern
      );

      if (!nextName) {
        throw new Error(`Clash 节点组“${groupName}”没有可轮换的节点。`);
      }

      await switchProxy(state, nextName);
      await setState({
        clashBridgeLastProxyName: nextName,
        clashBridgeCurrentProxyName: nextName,
        ...(storedNodes.length
          ? { proxySelectedNodeId: storedNodes.find((node) => node.name === nextName)?.id || state.proxySelectedNodeId || '' }
          : {}),
      });

      return {
        ok: true,
        skipped: false,
        groupName,
        from: currentName,
        to: nextName,
        totalCandidates: proxyNames.length,
      };
    }

    async function rotateAfterRound(targetRun, totalRuns, roundSummary = {}) {
      if (targetRun >= totalRuns) {
        return { ok: true, skipped: true, reason: 'last-round' };
      }

      const state = await getState();
      if (!state?.clashBridgeEnabled) {
        return { ok: true, skipped: true, reason: 'disabled' };
      }

      try {
        const result = await rotateOnce({ state, roundSummary });
        if (!result.skipped) {
          await addLog(
            result.from && result.from !== result.to
              ? `Clash 桥接：第 ${targetRun}/${totalRuns} 轮结束，已从“${result.from}”切换到“${result.to}”。`
              : `Clash 桥接：第 ${targetRun}/${totalRuns} 轮结束，已切换到“${result.to}”。`,
            'ok'
          );
        }
        return result;
      } catch (error) {
        await addLog(`Clash 桥接：第 ${targetRun}/${totalRuns} 轮结束后切换节点失败：${error.message}`, 'error');
        return {
          ok: false,
          skipped: false,
          errorMessage: error.message,
        };
      }
    }

    return {
      rotateAfterRound,
      rotateOnce,
    };
  }

  return {
    DEFAULT_CONTROLLER_URL,
    DEFAULT_EXCLUDE_PATTERN,
    DEFAULT_PROXY_GROUP,
    createClashBridge,
    getGroupProxyNames,
    normalizeControllerUrl,
    normalizeExcludePattern,
    normalizeProxyGroup,
    pickNextProxyName,
  };
});
