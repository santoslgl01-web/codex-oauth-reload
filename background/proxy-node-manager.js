(function attachBackgroundProxyNodeManager(root, factory) {
  root.MultiPageBackgroundProxyNodeManager = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundProxyNodeManagerModule() {
  const DEFAULT_PROXY_RULE_DOMAINS = [
    'chatgpt.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'api.openai.com',
  ];
  const PROXY_BACKEND_BROWSER = 'browser';
  const PROXY_BACKEND_CLASH = 'clash';
  const DEFAULT_PROXY_BACKEND = PROXY_BACKEND_BROWSER;
  const DEFAULT_CLASH_CONTROL_URL = 'http://127.0.0.1:9090';
  const DEFAULT_CLASH_PROXY_HOST = '127.0.0.1';
  const DEFAULT_CLASH_MIXED_PORT = 7890;
  const DEFAULT_CLASH_SELECTOR_GROUP = 'NODE-SELECT';
  const DEFAULT_CLASH_DELAY_TEST_URL = 'https://chatgpt.com/cdn-cgi/trace';
  const CLASH_SUPPORTED_TYPES = new Set([
    'http',
    'socks5',
    'socks4',
    'ss',
    'ssr',
    'trojan',
    'vmess',
    'vless',
    'snell',
    'hysteria',
    'hysteria2',
    'wireguard',
    'tuic',
    'direct',
  ]);

  const HERO_SMS_COUNTRY_TO_ISO2 = {
    1: 'RU',
    6: 'ID',
    16: 'GB',
    22: 'IN',
    27: 'ZA',
    36: 'CA',
    44: 'MY',
    74: 'DE',
    82: 'FR',
    93: 'AT',
    98: 'IR',
    101: 'ES',
    110: 'UA',
    122: 'HK',
    129: 'SG',
    145: 'MO',
    166: 'TW',
    172: 'JP',
    187: 'US',
    201: 'KR',
    204: 'AU',
    230: 'BR',
    245: 'MX',
  };

  function createProxyNodeManager(deps = {}) {
    const {
      addLog = async () => {},
      broadcastDataUpdate = () => {},
      chrome = globalThis.chrome,
      fetchImpl = globalThis.fetch,
      getState,
      setPersistentSettings,
      setState,
      PROXY_NODE_REFRESH_ALARM_NAME = 'proxy-node-refresh',
      PROXY_NODE_ROTATE_ALARM_NAME = 'proxy-node-rotate',
      PROXY_TEST_URL = 'https://chatgpt.com/cdn-cgi/trace',
      DEFAULT_PROXY_NODE_SOURCE_REPO = 'free-nodes/clashfree',
      CLASH_NODE_ROTATE_INTERVAL_MINUTES = 5,
    } = deps;

    let refreshInFlight = null;
    let proxyMutationQueue = Promise.resolve();
    const geoLookupCache = new Map();

    function withProxyLock(task) {
      const runner = async () => {
        try {
          return await task();
        } catch (error) {
          throw error;
        }
      };
      const next = proxyMutationQueue.then(runner, runner);
      proxyMutationQueue = next.then(() => undefined, () => undefined);
      return next;
    }

    function normalizeProxyMode(value = '') {
      const mode = String(value || '').trim().toLowerCase();
      if (mode === 'global') return 'global';
      if (mode === 'rule') return 'rule';
      return 'off';
    }

    function normalizeProxyBackend(value = '') {
      const backend = String(value || '').trim().toLowerCase();
      return backend === PROXY_BACKEND_CLASH
        ? PROXY_BACKEND_CLASH
        : PROXY_BACKEND_BROWSER;
    }

    function normalizeClashControlUrl(value = '') {
      const raw = String(value || '').trim();
      if (!raw) return DEFAULT_CLASH_CONTROL_URL;
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      try {
        const parsed = new URL(withScheme);
        const protocol = parsed.protocol === 'https:' ? 'https:' : 'http:';
        return `${protocol}//${parsed.host}`;
      } catch (_) {
        return DEFAULT_CLASH_CONTROL_URL;
      }
    }

    function normalizeClashProxyHost(value = '') {
      const host = String(value || '').trim();
      if (!host) return DEFAULT_CLASH_PROXY_HOST;
      if (!/^[a-zA-Z0-9.-]+$/.test(host)) return DEFAULT_CLASH_PROXY_HOST;
      return host;
    }

    function normalizeClashMixedPort(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 65535) {
        return DEFAULT_CLASH_MIXED_PORT;
      }
      return Math.floor(numeric);
    }

    function normalizeClashSelectorGroup(value = '') {
      const group = String(value || '').trim();
      return group || DEFAULT_CLASH_SELECTOR_GROUP;
    }

    function normalizeClashDelayTestUrl(value = '') {
      const raw = String(value || '').trim();
      if (!raw) return DEFAULT_CLASH_DELAY_TEST_URL;
      try {
        const parsed = new URL(raw);
        if (!/^https?:$/i.test(parsed.protocol)) return DEFAULT_CLASH_DELAY_TEST_URL;
        return parsed.toString();
      } catch (_) {
        return DEFAULT_CLASH_DELAY_TEST_URL;
      }
    }

    function normalizeProxyNodeId(value = '') {
      return String(value || '').trim();
    }

    function normalizeProxyRuleDomains(value) {
      const domains = Array.isArray(value) ? value : DEFAULT_PROXY_RULE_DOMAINS;
      const seen = new Set();
      const normalized = [];
      for (const item of domains) {
        const domain = String(item || '').trim().toLowerCase().replace(/^\.+/, '');
        if (!domain) continue;
        if (!/^[a-z0-9.-]+$/.test(domain)) continue;
        if (seen.has(domain)) continue;
        seen.add(domain);
        normalized.push(domain);
      }
      return normalized.length ? normalized : [...DEFAULT_PROXY_RULE_DOMAINS];
    }

    function normalizeCliproxyHost(value = '') {
      const host = String(value || '').trim();
      if (!host) return 'us2.cliproxy.io';
      if (!/^[a-zA-Z0-9.-]+$/.test(host)) return 'us2.cliproxy.io';
      return host;
    }

    function normalizeCliproxyPort(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 65535) return 3010;
      return Math.floor(numeric);
    }

    function normalizeCliproxyType(value = '') {
      const type = String(value || '').trim().toLowerCase();
      if (type === 'socks5' || type === 'socks') return 'socks5';
      return 'http';
    }

    function normalizeProxyValidationUrl(value = '') {
      const raw = String(value || '').trim();
      if (!raw) return 'https://mayips.com';
      try {
        const parsed = new URL(raw);
        if (!/^https?:$/i.test(parsed.protocol)) return 'https://mayips.com';
        return parsed.toString();
      } catch (_) {
        return 'https://mayips.com';
      }
    }

    function normalizeCountryCode(value = '') {
      const code = String(value || '').trim().toUpperCase();
      return /^[A-Z]{2}$/.test(code) ? code : '';
    }

    function normalizeCountryName(value = '') {
      return String(value || '').trim();
    }

    function normalizeRegionName(value = '') {
      return String(value || '').trim();
    }

    function isPrivateIpv4(ip = '') {
      const match = String(ip || '').match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (!match) return true;
      const [a, b] = [Number(match[1]), Number(match[2])];
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      return false;
    }

    function extractIpFromText(rawText = '') {
      const text = String(rawText || '');
      const keyMatch = text.match(/\bip\s*[:=]\s*([0-9a-fA-F:.]+)/i);
      if (keyMatch && keyMatch[1]) {
        return keyMatch[1].trim();
      }

      const ipv4Matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
      for (const candidate of ipv4Matches) {
        if (!isPrivateIpv4(candidate)) {
          return candidate;
        }
      }
      return '';
    }

    function pickFirstNonEmpty(...values) {
      for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
      }
      return '';
    }

    function parseGeoFromJsonPayload(payload = {}) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ip: '', countryCode: '', countryName: '', region: '' };
      }

      const ip = pickFirstNonEmpty(payload.ip, payload.query, payload.origin, payload.remote_ip, payload.client_ip);
      const countryCode = normalizeCountryCode(
        pickFirstNonEmpty(payload.country_code, payload.countryCode, payload.country)
      );
      const countryName = normalizeCountryName(
        pickFirstNonEmpty(payload.country_name, payload.countryName, payload.countryNameZh, payload.country_name_zh)
      );
      const region = normalizeRegionName(
        pickFirstNonEmpty(payload.region_name, payload.regionName, payload.region, payload.city)
      );
      return { ip, countryCode, countryName, region };
    }

    function parseGeoFromResponseText(rawText = '', contentType = '') {
      const text = String(rawText || '').trim();
      const normalizedType = String(contentType || '').toLowerCase();
      if (!text) {
        return { ip: '', countryCode: '', countryName: '', region: '' };
      }

      if (normalizedType.includes('application/json') || /^[\[{]/.test(text)) {
        try {
          const parsed = JSON.parse(text);
          return parseGeoFromJsonPayload(parsed);
        } catch (_) {}
      }

      const ip = extractIpFromText(text);
      const countryCodeFromText = normalizeCountryCode(
        pickFirstNonEmpty(
          (text.match(/\bcountry(?:_code)?\s*[:=]\s*([A-Za-z]{2})\b/i) || [])[1],
          (text.match(/\b国家(?:代码)?\s*[:：]\s*([A-Za-z]{2})\b/i) || [])[1]
        )
      );
      const countryNameFromText = normalizeCountryName(
        pickFirstNonEmpty(
          (text.match(/\bcountry[_\s-]*name\s*[:=]\s*([A-Za-z\u4e00-\u9fff\s-]{2,40})/i) || [])[1],
          (text.match(/\b国家\s*[:：]\s*([A-Za-z\u4e00-\u9fff\s-]{2,40})/i) || [])[1]
        )
      );
      const regionFromText = normalizeRegionName(
        pickFirstNonEmpty(
          (text.match(/\bregion(?:_name)?\s*[:=]\s*([A-Za-z\u4e00-\u9fff\s-]{2,50})/i) || [])[1],
          (text.match(/\b地区\s*[:：]\s*([A-Za-z\u4e00-\u9fff\s-]{2,50})/i) || [])[1]
        )
      );

      return {
        ip,
        countryCode: countryCodeFromText,
        countryName: countryNameFromText,
        region: regionFromText,
      };
    }

    async function lookupGeoByIp(ip = '', timeoutMs = 8000) {
      const normalizedIp = String(ip || '').trim();
      if (!normalizedIp) {
        return { countryCode: '', countryName: '', region: '' };
      }

      const cached = geoLookupCache.get(normalizedIp);
      if (cached && Number(cached.expiresAt) > Date.now()) {
        return cached.value;
      }

      const candidates = [
        `https://ipapi.co/${encodeURIComponent(normalizedIp)}/json/`,
        `https://ipwho.is/${encodeURIComponent(normalizedIp)}`,
      ];
      let resolved = { countryCode: '', countryName: '', region: '' };

      for (const target of candidates) {
        try {
          const response = await fetchWithTimeout(target, {
            headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' },
          }, timeoutMs);
          if (!response.ok) continue;
          const text = await response.text();
          const parsed = parseGeoFromResponseText(text, response.headers?.get?.('content-type') || 'application/json');
          resolved = {
            countryCode: normalizeCountryCode(parsed.countryCode),
            countryName: normalizeCountryName(parsed.countryName),
            region: normalizeRegionName(parsed.region),
          };
          if (resolved.countryCode || resolved.countryName || resolved.region) {
            break;
          }
        } catch (_) {}
      }

      geoLookupCache.set(normalizedIp, {
        value: resolved,
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      });
      return resolved;
    }

    async function resolveProbeGeoInfo(response, options = {}) {
      let text = '';
      let contentType = '';
      try {
        contentType = String(response?.headers?.get?.('content-type') || '');
      } catch (_) {}
      try {
        text = String(await response.text() || '').slice(0, 24000);
      } catch (_) {}

      const parsed = parseGeoFromResponseText(text, contentType);
      const ip = String(parsed.ip || '').trim();
      const geo = ip ? await lookupGeoByIp(ip, options.timeoutMs || 8000) : { countryCode: '', countryName: '', region: '' };

      return {
        ip,
        countryCode: normalizeCountryCode(pickFirstNonEmpty(parsed.countryCode, geo.countryCode)),
        countryName: normalizeCountryName(pickFirstNonEmpty(parsed.countryName, geo.countryName)),
        region: normalizeRegionName(pickFirstNonEmpty(parsed.region, geo.region)),
      };
    }

    function normalizeHeroSmsCountry(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return 187;
      }
      return Math.floor(numeric);
    }

    function getHeroSmsCountryIso2(countryId) {
      return HERO_SMS_COUNTRY_TO_ISO2[normalizeHeroSmsCountry(countryId)] || '';
    }

    function resolveProxyBackendForState(state = {}, options = {}) {
      if (options.backend !== undefined) {
        return normalizeProxyBackend(options.backend);
      }
      return normalizeProxyBackend(state.proxyBackend);
    }

    function resolveClashBridgeConfig(state = {}, options = {}) {
      const controllerUrl = normalizeClashControlUrl(options.clashControlUrl ?? state.clashControlUrl);
      const secret = String(options.clashSecret ?? state.clashSecret ?? '').trim();
      const proxyHost = normalizeClashProxyHost(options.clashProxyHost ?? state.clashProxyHost);
      const mixedPort = normalizeClashMixedPort(options.clashMixedPort ?? state.clashMixedPort);
      const selectorGroup = normalizeClashSelectorGroup(options.clashSelectorGroup ?? state.clashSelectorGroup);
      const delayTestUrl = normalizeClashDelayTestUrl(options.clashDelayTestUrl ?? state.clashDelayTestUrl);
      let controllerHostPort = '127.0.0.1:9090';
      try {
        controllerHostPort = new URL(controllerUrl).host || controllerHostPort;
      } catch (_) {}
      return {
        backend: PROXY_BACKEND_CLASH,
        controllerUrl,
        secret,
        proxyHost,
        mixedPort,
        selectorGroup,
        delayTestUrl,
        controllerHostPort,
      };
    }

    function normalizeYamlScalar(rawValue) {
      const value = String(rawValue || '').trim();
      if (!value) return '';
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        return value.slice(1, -1);
      }
      if (/^(true|false)$/i.test(value)) {
        return /^true$/i.test(value);
      }
      if (/^-?\d+(?:\.\d+)?$/.test(value)) {
        return Number(value);
      }
      return value;
    }

    function normalizeClashRawNode(rawNode = {}) {
      const output = {};
      for (const [rawKey, rawValue] of Object.entries(rawNode || {})) {
        const key = String(rawKey || '').trim();
        if (!key) continue;
        if (key.startsWith('__')) continue;
        if (/[\r\n]/.test(key)) continue;
        const value = rawValue;
        if (value === null || value === undefined) continue;
        if (typeof value === 'boolean' || typeof value === 'number') {
          output[key] = value;
          continue;
        }
        if (typeof value === 'string') {
          output[key] = value.replace(/\r?\n/g, ' ').trim();
        }
      }
      return output;
    }

    function splitTopLevel(text, delimiter = ',') {
      const input = String(text || '');
      const parts = [];
      let buffer = '';
      let quote = '';
      let braceDepth = 0;
      let bracketDepth = 0;
      let parenDepth = 0;

      for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (quote) {
          buffer += char;
          if (char === quote && input[index - 1] !== '\\') {
            quote = '';
          }
          continue;
        }

        if (char === '"' || char === "'") {
          quote = char;
          buffer += char;
          continue;
        }

        if (char === '{') braceDepth += 1;
        if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
        if (char === '[') bracketDepth += 1;
        if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        if (char === '(') parenDepth += 1;
        if (char === ')') parenDepth = Math.max(0, parenDepth - 1);

        if (
          char === delimiter
          && braceDepth === 0
          && bracketDepth === 0
          && parenDepth === 0
        ) {
          parts.push(buffer.trim());
          buffer = '';
          continue;
        }

        buffer += char;
      }

      if (buffer.trim()) {
        parts.push(buffer.trim());
      }

      return parts;
    }

    function parseTopLevelKeyValue(text) {
      const input = String(text || '').trim();
      if (!input) return null;

      const segments = splitTopLevel(input, ':');
      if (segments.length < 2) {
        return null;
      }

      const key = String(segments.shift() || '').trim();
      if (!key) return null;
      const rawValue = segments.join(':').trim();
      return [key, normalizeYamlScalar(rawValue)];
    }

    function parseInlineProxyMap(line) {
      const text = String(line || '').trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) {
        return null;
      }

      const body = text.slice(start + 1, end);
      const entries = splitTopLevel(body, ',');
      const node = {};
      for (const entry of entries) {
        const pair = parseTopLevelKeyValue(entry);
        if (!pair) continue;
        node[pair[0]] = pair[1];
      }
      node.__rawInlineMap = text.slice(start, end + 1);
      return node;
    }

    function parseBlockProxy(blockLines = []) {
      const node = {};
      for (const line of blockLines) {
        const pair = parseTopLevelKeyValue(line);
        if (!pair) continue;
        node[pair[0]] = pair[1];
      }
      return node;
    }

    function parseClashProxyFile(content = '') {
      const lines = String(content || '').split(/\r?\n/);
      const nodes = [];
      let inProxies = false;
      let blockIndent = null;
      let currentBlock = [];

      function flushCurrentBlock() {
        if (!currentBlock.length) return;
        const parsed = parseBlockProxy(currentBlock);
        if (Object.keys(parsed).length) {
          nodes.push(parsed);
        }
        currentBlock = [];
      }

      for (const line of lines) {
        if (!inProxies) {
          if (/^\s*proxies\s*:\s*$/.test(line)) {
            inProxies = true;
          }
          continue;
        }

        if (!line.trim()) continue;

        const indent = (line.match(/^\s*/) || [''])[0].length;

        if (blockIndent === null && /^\s*-\s*/.test(line)) {
          blockIndent = indent;
        }

        if (blockIndent !== null && indent < blockIndent && /\S/.test(line)) {
          flushCurrentBlock();
          break;
        }

        if (/^\s*-\s*\{/.test(line)) {
          flushCurrentBlock();
          const parsed = parseInlineProxyMap(line);
          if (parsed && Object.keys(parsed).length) {
            nodes.push(parsed);
          }
          continue;
        }

        if (/^\s*-\s+/.test(line)) {
          flushCurrentBlock();
          currentBlock.push(line.replace(/^\s*-\s*/, '').trim());
          continue;
        }

        if (currentBlock.length) {
          currentBlock.push(line.trim());
        }
      }

      flushCurrentBlock();
      return nodes;
    }

    function extractCountryCodeFromFlag(name = '') {
      const text = String(name || '');
      const chars = Array.from(text);
      for (let index = 0; index < chars.length - 1; index += 1) {
        const first = chars[index].codePointAt(0);
        const second = chars[index + 1].codePointAt(0);
        if (
          first >= 0x1f1e6
          && first <= 0x1f1ff
          && second >= 0x1f1e6
          && second <= 0x1f1ff
        ) {
          return String.fromCharCode(first - 0x1f1e6 + 65, second - 0x1f1e6 + 65);
        }
      }
      return '';
    }

    function extractCountryCodeFromName(name = '') {
      const fromFlag = extractCountryCodeFromFlag(name);
      if (fromFlag) return fromFlag;

      const match = String(name || '').match(/\b([A-Z]{2})\b/);
      if (match) return match[1].toUpperCase();

      return '';
    }

    function extractCountryCodeFromCliproxyUsername(username = '') {
      const match = String(username || '').match(/(?:^|-)region-([a-z]{2})(?:-|$)/i);
      if (match) return String(match[1] || '').toUpperCase();
      return '';
    }

    function buildCliproxyNodeFromState(state = {}, sourceFile = '', index = 0) {
      if (!Boolean(state?.cliproxyEnabled)) {
        return null;
      }

      const host = normalizeCliproxyHost(state?.cliproxyHost);
      const port = normalizeCliproxyPort(state?.cliproxyPort);
      const username = String(state?.cliproxyUsername || '').trim();
      const password = String(state?.cliproxyPassword || '').trim();
      const type = normalizeCliproxyType(state?.cliproxyType);

      if (!username || !password) {
        return null;
      }

      const countryCode = extractCountryCodeFromCliproxyUsername(username);
      const regionLabel = countryCode || 'AUTO';
      const rawNode = {
        name: `Cliproxy ${regionLabel}`,
        server: host,
        port: Math.floor(port),
        type,
        username,
        password,
      };
      const normalized = normalizeProxyNode(rawNode, index, sourceFile);
      if (!normalized) {
        return null;
      }
      normalized.id = `cliproxy::${type}::${host}:${Math.floor(port)}::${regionLabel}`;
      normalized.name = rawNode.name;
      normalized.countryCode = countryCode || normalized.countryCode;
      normalized.raw = {
        ...normalized.raw,
        name: rawNode.name,
        server: host,
        port: Math.floor(port),
        type,
        username,
        password,
      };
      return normalized;
    }

    function getChromeProxyScheme(type = '') {
      const normalized = String(type || '').trim().toLowerCase();
      if (normalized === 'http' || normalized === 'https') return 'http';
      if (normalized === 'socks5' || normalized === 'socks') return 'socks5';
      if (normalized === 'socks4') return 'socks4';
      return '';
    }

    function buildProxyNodeId(rawNode = {}, index = 0, sourceFile = '') {
      const name = String(rawNode.name || '').trim();
      const server = String(rawNode.server || '').trim();
      const port = Number(rawNode.port) || 0;
      const type = String(rawNode.type || '').trim().toLowerCase();
      const source = String(sourceFile || '').trim();
      return `${source || 'clash'}::${index}::${type}::${server}:${port}::${name}`;
    }

    function normalizeProxyNode(rawNode = {}, index = 0, sourceFile = '') {
      const type = String(rawNode.type || '').trim().toLowerCase();
      const name = String(rawNode.name || '').trim() || `node-${index + 1}`;
      const server = String(rawNode.server || '').trim();
      const port = Number(rawNode.port);
      const scheme = getChromeProxyScheme(type);
      const clashSupported = CLASH_SUPPORTED_TYPES.has(type);
      const username = String(rawNode.username || '').trim();
      const password = String(rawNode.password || '').trim();

      if (!server || !Number.isFinite(port) || port <= 0 || port > 65535) {
        return null;
      }

      const status = !scheme ? 'unsupported_type' : 'pending';

      return {
        id: buildProxyNodeId(rawNode, index, sourceFile),
        name,
        server,
        port: Math.floor(port),
        type,
        username,
        password,
        requiresAuth: Boolean(username || password),
        scheme,
        sourceFile: String(sourceFile || '').trim(),
        countryCode: extractCountryCodeFromName(name),
        usable: false,
        status,
        validationError: status === 'unsupported_type'
          ? `不支持的节点类型：${type || 'unknown'}`
          : '',
        lastCheckedAt: 0,
        latencyMs: 0,
        detectedIp: '',
        detectedCountryCode: '',
        detectedCountryName: '',
        detectedRegion: '',
        clashSupported,
        clashName: '',
        raw: normalizeClashRawNode(rawNode),
        rawInlineMap: String(rawNode.__rawInlineMap || '').trim(),
      };
    }

    function normalizeProxyNodesForStorage(value) {
      if (!Array.isArray(value)) {
        return [];
      }

      return value
        .map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return null;
          }
          const normalized = normalizeProxyNode({
            name: item.name,
            server: item.server,
            port: item.port,
            type: item.type,
            username: item.username,
            password: item.password,
          }, 0, item.sourceFile || '');
          if (!normalized) return null;
          normalized.id = normalizeProxyNodeId(item.id || normalized.id);
          normalized.usable = Boolean(item.usable);
          normalized.status = String(item.status || normalized.status || '').trim() || 'unknown';
          normalized.validationError = String(item.validationError || '').trim();
          normalized.lastCheckedAt = Number(item.lastCheckedAt) || 0;
          normalized.latencyMs = Math.max(0, Math.floor(Number(item.latencyMs) || 0));
          normalized.detectedIp = String(item.detectedIp || '').trim();
          normalized.detectedCountryCode = String(item.detectedCountryCode || '').trim().toUpperCase();
          normalized.detectedCountryName = String(item.detectedCountryName || '').trim();
          normalized.detectedRegion = String(item.detectedRegion || '').trim();
          normalized.countryCode = String(item.countryCode || normalized.countryCode || '').trim().toUpperCase();
          normalized.username = String(item.username || normalized.username || '').trim();
          normalized.password = String(item.password || normalized.password || '').trim();
          normalized.requiresAuth = Boolean(normalized.username || normalized.password);
          normalized.clashSupported = item.clashSupported !== undefined
            ? Boolean(item.clashSupported)
            : CLASH_SUPPORTED_TYPES.has(normalized.type);
          normalized.clashName = String(item.clashName || '').trim();
          normalized.raw = normalizeClashRawNode(item.raw || {});
          normalized.rawInlineMap = String(item.rawInlineMap || '').trim();
          return normalized;
        })
        .filter(Boolean)
        .slice(0, 500);
    }

    function promisifyChromeMethod(target, method, ...args) {
      if (!target || typeof target[method] !== 'function') {
        return Promise.reject(new Error(`chrome API 不支持: ${method}`));
      }

      return new Promise((resolve, reject) => {
        try {
          target[method](...args, (result) => {
            const runtimeError = chrome?.runtime?.lastError;
            if (runtimeError) {
              reject(new Error(runtimeError.message || String(runtimeError)));
              return;
            }
            resolve(result);
          });
        } catch (error) {
          reject(error);
        }
      });
    }

    async function getCurrentProxySettings() {
      if (!chrome?.proxy?.settings) {
        return null;
      }
      return promisifyChromeMethod(chrome.proxy.settings, 'get', { incognito: false });
    }

    async function setProxySettingsValue(value) {
      if (!chrome?.proxy?.settings) {
        throw new Error('当前浏览器不支持 chrome.proxy API。');
      }
      return promisifyChromeMethod(chrome.proxy.settings, 'set', { value, scope: 'regular' });
    }

    async function clearProxySettingsValue() {
      if (!chrome?.proxy?.settings) {
        return;
      }
      return promisifyChromeMethod(chrome.proxy.settings, 'clear', { scope: 'regular' });
    }

    async function restoreProxySettings(snapshot) {
      if (!snapshot || !chrome?.proxy?.settings) {
        return;
      }

      const value = snapshot.value || null;
      if (!value || value.mode === 'direct' || value.mode === 'system') {
        await clearProxySettingsValue();
        return;
      }

      await setProxySettingsValue(value);
    }

    function buildProxyToken(node) {
      if (!node) return '';
      const host = String(node.server || '').trim();
      const port = Number(node.port);
      const scheme = String(node.scheme || '').trim().toLowerCase();
      if (!host || !Number.isFinite(port) || port <= 0) {
        return '';
      }

      if (scheme === 'socks5') {
        return `SOCKS5 ${host}:${port}`;
      }
      if (scheme === 'socks4') {
        return `SOCKS ${host}:${port}`;
      }
      return `PROXY ${host}:${port}`;
    }

    function buildPacScript(node, ruleDomains = DEFAULT_PROXY_RULE_DOMAINS) {
      const domains = normalizeProxyRuleDomains(ruleDomains);
      const proxyToken = buildProxyToken(node);
      const domainChecks = domains
        .map((domain) => `dnsDomainIs(host, \"${domain}\") || shExpMatch(host, \"*.${domain}\")`)
        .join(' || ');

      return `function FindProxyForURL(url, host) {
  host = (host || \"\").toLowerCase();
  if (${domainChecks}) {
    return \"${proxyToken}\";
  }
  return \"DIRECT\";
}`;
    }

    function buildChromeProxyConfigForNode(node, options = {}) {
      const mode = normalizeProxyMode(options.mode || 'global');
      const scheme = String(node?.scheme || '').trim().toLowerCase();
      const host = String(node?.server || '').trim();
      const port = Number(node?.port);

      if (!scheme || !host || !Number.isFinite(port) || port <= 0) {
        throw new Error('代理节点配置不完整，无法应用到浏览器。');
      }

      if (mode === 'rule') {
        return {
          mode: 'pac_script',
          pacScript: {
            data: buildPacScript(node, options.ruleDomains),
          },
        };
      }

      return {
        mode: 'fixed_servers',
        rules: {
          singleProxy: {
            scheme,
            host,
            port: Math.floor(port),
          },
          bypassList: ['<local>'],
        },
      };
    }

    function buildChromeProxyConfigForClash(clashConfig, options = {}) {
      const mode = normalizeProxyMode(options.mode || 'global');
      const host = normalizeClashProxyHost(clashConfig?.proxyHost);
      const port = normalizeClashMixedPort(clashConfig?.mixedPort);
      const localNode = {
        scheme: 'http',
        server: host,
        port,
      };
      return buildChromeProxyConfigForNode(localNode, {
        mode,
        ruleDomains: options.ruleDomains,
      });
    }

    function stringifyYamlScalar(value) {
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
      const escaped = text.replace(/'/g, "''");
      return `'${escaped}'`;
    }

    function toClashProxyName(rawName = '', index = 0) {
      const text = String(rawName || '').replace(/\r?\n/g, ' ').trim() || `node-${index + 1}`;
      return text.length > 120 ? text.slice(0, 120) : text;
    }

    function dedupeClashProxyNames(nodes = []) {
      return nodes.map((node, index) => ({
        ...node,
        clashName: toClashProxyName(node.name, index),
      }));
    }

    function buildClashProxyYamlBlock(node) {
      const inlineMap = String(node.rawInlineMap || '').trim();
      if (inlineMap.startsWith('{') && inlineMap.endsWith('}')) {
        return `  - ${inlineMap}`;
      }
      const raw = normalizeClashRawNode(node.raw || {});
      const mapped = {
        ...raw,
        name: node.clashName || node.name,
      };
      const preferredOrder = ['name', 'type', 'server', 'port'];
      const orderedKeys = [
        ...preferredOrder.filter((key) => mapped[key] !== undefined),
        ...Object.keys(mapped).filter((key) => !preferredOrder.includes(key)),
      ];
      const lines = [];
      for (const key of orderedKeys) {
        const value = mapped[key];
        if (value === undefined || value === null || value === '') continue;
        lines.push(`    ${key}: ${stringifyYamlScalar(value)}`);
      }
      return `  -\n${lines.join('\n')}`;
    }

    function buildClashManagedConfigPayload(nodes = [], state = {}, clashConfig = {}) {
      const selectorGroup = normalizeClashSelectorGroup(clashConfig.selectorGroup);
      const delayUrl = normalizeClashDelayTestUrl(clashConfig.delayTestUrl || state.clashDelayTestUrl);
      const controllerHostPort = String(clashConfig.controllerHostPort || '127.0.0.1:9090').trim();
      const mixedPort = normalizeClashMixedPort(clashConfig.mixedPort);
      const domains = normalizeProxyRuleDomains(state.proxyRuleDomains);
      const proxyNameLines = nodes.map((node) => `      - ${stringifyYamlScalar(node.clashName || node.name)}`).join('\n');
      const proxyBlocks = nodes.map((node) => buildClashProxyYamlBlock(node)).join('\n');
      const ruleLines = domains.map((domain) => `  - DOMAIN-SUFFIX,${domain},${selectorGroup}`).join('\n');
      const secret = String(clashConfig.secret || '').trim();
      const secretLine = secret ? `secret: ${stringifyYamlScalar(secret)}\n` : '';

      return `mixed-port: ${mixedPort}
allow-lan: false
mode: rule
log-level: info
external-controller: ${stringifyYamlScalar(controllerHostPort)}
${secretLine}proxies:
${proxyBlocks}
proxy-groups:
  - name: ${stringifyYamlScalar(selectorGroup)}
    type: select
    proxies:
${proxyNameLines}
rules:
${ruleLines}
  - MATCH,DIRECT
`;
    }

    async function requestClashApi(path, clashConfig = {}, options = {}) {
      const baseUrl = normalizeClashControlUrl(clashConfig.controllerUrl);
      const secret = String(clashConfig.secret || '').trim();
      const method = String(options.method || 'GET').toUpperCase();
      const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs || 10000);
      const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
      const headers = {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        ...(options.headers || {}),
      };
      let body = options.body;
      if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.json);
      }
      if (secret) {
        headers.Authorization = `Bearer ${secret}`;
      }

      let response = null;
      try {
        response = await fetchWithTimeout(url, {
          method,
          headers,
          body,
        }, timeoutMs);
      } catch (error) {
        const message = error?.message || String(error || 'unknown_error');
        throw new Error(`无法连接 Clash 控制器（${baseUrl}）：${message}`);
      }

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = text;
        }
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Clash API 鉴权失败 (${response.status})：请在扩展侧边栏填写正确的 CLASH SECRET（当前控制器：${baseUrl}）。`
          );
        }
        const message = typeof data === 'string'
          ? data
          : (data?.message || data?.error || '');
        const error = new Error(`Clash API ${method} ${path} 失败 (${response.status})${message ? `：${message}` : ''}`);
        error.status = response.status;
        error.method = method;
        error.path = path;
        error.apiMessage = message;
        throw error;
      }
      return data;
    }

    function isClashPayloadConfigUnsupportedError(error) {
      const status = Number(error?.status);
      const message = String(error?.message || error?.apiMessage || error || '');
      return (
        status === 400
        && /\/configs(?:\?force=true)?/i.test(String(error?.path || message))
        && /payload|path|config|invalid|bad request|not support|unsupported|\u4e0d\u652f\u6301|\u65e0\u6548|\u7f3a\u5c11/i.test(message)
      );
    }

    function isClashManagedConfigWriteFailure(error) {
      const status = Number(error?.status);
      const message = String(error?.message || error?.apiMessage || error || '');
      const path = String(error?.path || '');
      if (/当前 Clash API 不支持直接写入 payload|扩展无法写入本地配置文件|无法写入 Clash 配置文件/i.test(message)) {
        return true;
      }
      return (
        (status === 400 || status === 422)
        && (
          /\/configs(?:\?force=true)?/i.test(path)
          || /Clash API\s+PUT\s+\/configs(?:\?force=true)?\s+失败/i.test(message)
        )
        && /写入 Clash 配置|Clash 配置文件|payload|path required|invalid config|bad request|unsupported|not support|yaml|config/i.test(message)
      );
    }

    function callChromeDownloads(method, payload) {
      if (!chrome?.downloads || typeof chrome.downloads[method] !== 'function') {
        return Promise.reject(new Error('当前扩展缺少 chrome.downloads 权限，无法写入 Clash 配置文件。'));
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err, value) => {
          if (settled) return;
          settled = true;
          if (err) {
            reject(err);
          } else {
            resolve(value);
          }
        };

        try {
          const maybePromise = chrome.downloads[method](payload, (value) => {
            const lastError = chrome.runtime?.lastError;
            finish(lastError ? new Error(lastError.message || String(lastError)) : null, value);
          });
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(
              (value) => finish(null, value),
              (error) => finish(error)
            );
          }
        } catch (error) {
          finish(error);
        }
      });
    }

    async function sleepForDownload(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function persistClashManagedConfigPayload(payload, options = {}) {
      if (!chrome?.downloads?.download || !chrome?.downloads?.search) {
        throw new Error('当前 Clash API 不支持直接写入 payload，且扩展无法写入本地配置文件。请切换为“浏览器代理”后端，或升级 Clash/Mihomo 客户端。');
      }

      const filename = String(options.fileName || 'codex-oauth-automation/clash-managed.yaml')
        .replace(/^[\\/]+/, '')
        .replace(/\\/g, '/');
      const dataUrl = `data:text/yaml;charset=utf-8,${encodeURIComponent(String(payload || ''))}`;
      const downloadId = await callChromeDownloads('download', {
        url: dataUrl,
        filename,
        conflictAction: 'overwrite',
        saveAs: false,
      });

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const items = await callChromeDownloads('search', { id: downloadId }).catch(() => []);
        const item = Array.isArray(items) ? items[0] : null;
        if (item?.state === 'interrupted') {
          throw new Error(`写入 Clash 配置文件失败：${item.error || 'download_interrupted'}`);
        }
        if (item?.filename && (!item.state || item.state === 'complete')) {
          return item.filename;
        }
        await sleepForDownload(100);
      }

      throw new Error('写入 Clash 配置文件超时，无法取得本地文件路径。');
    }

    async function applyClashManagedConfig(nodes = [], state = {}, options = {}) {
      if (!nodes.length) {
        return { ok: false, error: '没有可写入 Clash 的节点。' };
      }
      const clashConfig = resolveClashBridgeConfig(state, options);
      const payload = buildClashManagedConfigPayload(nodes, state, clashConfig);
      try {
        await requestClashApi('/configs?force=true', clashConfig, {
          method: 'PUT',
          json: { payload },
          timeoutMs: options.timeoutMs || 15000,
        });
      } catch (error) {
        if (!isClashPayloadConfigUnsupportedError(error)) {
          throw error;
        }

        await addLog('代理节点：当前 Clash API 不支持直接写入 payload，正在写入本地 YAML 后按 path 重新加载...', 'warn');
        const path = await persistClashManagedConfigPayload(payload, options);
        await requestClashApi('/configs?force=true', clashConfig, {
          method: 'PUT',
          json: { path },
          timeoutMs: options.timeoutMs || 15000,
        });
      }
      return {
        ok: true,
        clashConfig,
      };
    }

    async function updateClashSelector(clashConfig, selectorGroup, nodeName, options = {}) {
      const group = encodeURIComponent(selectorGroup);
      await requestClashApi(`/proxies/${group}`, clashConfig, {
        method: 'PUT',
        json: { name: nodeName },
        timeoutMs: options.timeoutMs || 10000,
      });
    }

    async function patchClashMode(clashConfig, mode = 'rule', options = {}) {
      const normalized = mode === 'global' ? 'global' : 'rule';
      await requestClashApi('/configs', clashConfig, {
        method: 'PATCH',
        json: { mode: normalized },
        timeoutMs: options.timeoutMs || 10000,
      });
    }

    function resolveRequestTimeoutMs(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 10000;
      }
      return Math.max(3000, Math.min(30000, Math.floor(numeric)));
    }

    async function fetchWithTimeout(url, fetchOptions = {}, timeoutMs = 10000) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境缺少 fetch，无法拉取节点数据。');
      }

      const resolvedTimeout = resolveRequestTimeoutMs(timeoutMs);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller
        ? setTimeout(() => {
          try {
            controller.abort();
          } catch (_) {}
        }, resolvedTimeout)
        : null;

      try {
        const response = await fetchImpl(url, {
          ...fetchOptions,
          signal: controller?.signal,
        });
        return response;
      } catch (error) {
        if (controller?.signal?.aborted) {
          throw new Error(`请求超时(${resolvedTimeout}ms)：${url}`);
        }
        throw error;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }

    async function fetchJson(url, options = {}) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境缺少 fetch，无法拉取节点列表。');
      }

      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: 'application/vnd.github+json, application/json;q=0.9, */*;q=0.8',
        },
      }, options.timeoutMs);
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})：${url}`);
      }
      return response.json();
    }

    async function fetchText(url, options = {}) {
      if (typeof fetchImpl !== 'function') {
        throw new Error('当前环境缺少 fetch，无法拉取节点文件。');
      }

      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: 'text/plain, text/yaml;q=0.9, */*;q=0.8',
        },
      }, options.timeoutMs);
      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})：${url}`);
      }
      return response.text();
    }

    function formatUtcDateToken(dateInput = new Date()) {
      const date = new Date(dateInput);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    }

    function buildRawCandidateUrls(owner, name, branch, fileName) {
      return [
        `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${fileName}`,
        `https://cdn.jsdelivr.net/gh/${owner}/${name}@${branch}/${fileName}`,
        `https://fastly.jsdelivr.net/gh/${owner}/${name}@${branch}/${fileName}`,
        `https://gcore.jsdelivr.net/gh/${owner}/${name}@${branch}/${fileName}`,
        `https://testingcf.jsdelivr.net/gh/${owner}/${name}@${branch}/${fileName}`,
      ];
    }

    async function fetchLatestClashSourceFromRaw(owner, name, options = {}) {
      const branchCandidates = ['main', 'master'];
      const maxLookBackDays = Math.max(2, Math.min(14, Number(options.maxLookBackDays) || 7));
      const maxAttempts = Math.max(6, Math.min(80, Number(options.maxAttempts) || 24));
      const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs || 10000);
      const errors = [];
      let attempts = 0;

      for (let offset = 0; offset <= maxLookBackDays; offset += 1) {
        const candidateDate = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
        const fileName = `clash${formatUtcDateToken(candidateDate)}.yml`;

        for (const branch of branchCandidates) {
          const candidateUrls = buildRawCandidateUrls(owner, name, branch, fileName);
          for (const downloadUrl of candidateUrls) {
            if (attempts >= maxAttempts) {
              break;
            }
            attempts += 1;
            try {
              const rawText = await fetchText(downloadUrl, { timeoutMs });
              if (/^\s*proxies\s*:/m.test(rawText)) {
                return {
                  fileName,
                  downloadUrl,
                  rawText,
                };
              }
              errors.push(`${fileName}@${branch}: 文件不包含 proxies 段`);
            } catch (error) {
              errors.push(`${fileName}@${branch}: ${error?.message || String(error || 'unknown_error')}`);
            }
          }
          if (attempts >= maxAttempts) {
            break;
          }
        }
        if (attempts >= maxAttempts) {
          break;
        }
      }

      throw new Error(`无法从 GitHub/raw/CDN 镜像获取近 ${maxLookBackDays + 1} 天节点文件。已尝试 ${attempts} 次。${errors.length ? `示例错误：${errors[0]}` : ''}`);
    }

    function pickLatestClashFile(entries = []) {
      const files = entries
        .map((item) => item?.name)
        .filter((name) => /^clash\d{8}\.ya?ml$/i.test(String(name || '').trim()))
        .sort((left, right) => String(right).localeCompare(String(left)));

      return files[0] || '';
    }

    async function fetchLatestClashSource(repo = DEFAULT_PROXY_NODE_SOURCE_REPO, options = {}) {
      const repoText = String(repo || '').trim();
      const [owner, name] = repoText.split('/').map((part) => String(part || '').trim());
      if (!owner || !name) {
        throw new Error(`无效的 GitHub 仓库路径：${repoText}`);
      }

      let latestFile = '';
      let downloadUrl = '';
      let rawText = '';
      const timeoutMs = resolveRequestTimeoutMs(options.timeoutMs || 10000);

      try {
        const listing = await fetchJson(`https://api.github.com/repos/${owner}/${name}/contents`, { timeoutMs });
        if (!Array.isArray(listing)) {
          throw new Error('GitHub 仓库目录返回格式异常。');
        }

        latestFile = pickLatestClashFile(listing);
        if (!latestFile) {
          throw new Error('仓库中未找到 clashYYYYMMDD.yml 节点文件。');
        }

        const latestEntry = listing.find((item) => item?.name === latestFile);
        downloadUrl = latestEntry?.download_url
          || `https://raw.githubusercontent.com/${owner}/${name}/main/${latestFile}`;
        rawText = await fetchText(downloadUrl, { timeoutMs });
      } catch (apiError) {
        await addLog(`代理节点：GitHub API 拉取失败，尝试 raw 直连回退（${apiError?.message || apiError}）`, 'warn');
        const fallback = await fetchLatestClashSourceFromRaw(owner, name, { timeoutMs });
        latestFile = fallback.fileName;
        downloadUrl = fallback.downloadUrl;
        rawText = fallback.rawText;
      }

      return {
        repo: repoText,
        fileName: latestFile,
        downloadUrl,
        rawText,
      };
    }

    async function probeNodeReachability(node, options = {}) {
      const timeoutMs = Math.max(2000, Math.min(20000, Number(options.timeoutMs) || 8000));
      const testUrl = String(options.testUrl || PROXY_TEST_URL || 'https://chatgpt.com/cdn-cgi/trace').trim();
      if (!chrome?.proxy?.settings) {
        return {
          ok: true,
          skipped: true,
          error: '',
          latencyMs: 0,
          detectedIp: '',
          detectedCountryCode: '',
          detectedCountryName: '',
          detectedRegion: '',
        };
      }

      return withProxyLock(async () => {
        const snapshot = await getCurrentProxySettings();
        const config = buildChromeProxyConfigForNode(node, { mode: 'global' });
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller
          ? setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
          : null;
        const startedAt = Date.now();

        try {
          await setProxySettingsValue(config);
          const response = await fetchImpl(testUrl, {
            cache: 'no-store',
            signal: controller?.signal,
          });
          const ok = response.status >= 200 && response.status < 500;
          const geoInfo = await resolveProbeGeoInfo(response, { timeoutMs: Math.max(2500, timeoutMs) }).catch(() => ({
            ip: '',
            countryCode: '',
            countryName: '',
            region: '',
          }));
          return {
            ok,
            skipped: false,
            error: ok ? '' : `状态码 ${response.status}`,
            latencyMs: Math.max(1, Date.now() - startedAt),
            detectedIp: String(geoInfo.ip || '').trim(),
            detectedCountryCode: String(geoInfo.countryCode || '').trim().toUpperCase(),
            detectedCountryName: String(geoInfo.countryName || '').trim(),
            detectedRegion: String(geoInfo.region || '').trim(),
          };
        } catch (error) {
          return {
            ok: false,
            skipped: false,
            error: error?.message || String(error || 'unknown_error'),
            latencyMs: Math.max(1, Date.now() - startedAt),
            detectedIp: '',
            detectedCountryCode: '',
            detectedCountryName: '',
            detectedRegion: '',
          };
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
          await restoreProxySettings(snapshot).catch(() => {});
        }
      });
    }

    async function runConcurrent(limit, items, worker) {
      const resolvedLimit = Math.max(1, Math.min(24, Number(limit) || 6));
      const queue = Array.from(items || []);
      const results = new Array(queue.length);
      let cursor = 0;

      async function consume() {
        while (true) {
          const currentIndex = cursor;
          cursor += 1;
          if (currentIndex >= queue.length) return;
          results[currentIndex] = await worker(queue[currentIndex], currentIndex);
        }
      }

      const workers = Array.from({ length: Math.min(resolvedLimit, queue.length || 1) }, () => consume());
      await Promise.all(workers);
      return results;
    }

    async function validateNodesViaBrowser(nodes = [], options = {}) {
      const validated = [];
      const probeLimit = Math.max(1, Math.min(120, Number(options.probeLimit) || 20));
      let probeCount = 0;

      for (const node of nodes) {
        const current = { ...node };

        if (!current.scheme) {
          current.usable = false;
          current.status = 'unsupported_type';
          current.latencyMs = 0;
          current.detectedIp = '';
          current.detectedCountryCode = '';
          current.detectedCountryName = '';
          current.detectedRegion = '';
          current.lastCheckedAt = Date.now();
          validated.push(current);
          continue;
        }

        if (probeCount >= probeLimit) {
          current.usable = false;
          current.status = 'probe_skipped';
          current.validationError = `仅验证前 ${probeLimit} 个节点，剩余节点已跳过连通性探测。`;
          current.latencyMs = 0;
          current.detectedIp = '';
          current.detectedCountryCode = '';
          current.detectedCountryName = '';
          current.detectedRegion = '';
          current.lastCheckedAt = Date.now();
          validated.push(current);
          continue;
        }

        probeCount += 1;
        const result = await probeNodeReachability(current, options);
        current.usable = Boolean(result.ok);
        current.status = result.ok
          ? 'usable'
          : (result.skipped ? 'probe_skipped' : 'unreachable');
        current.validationError = result.error || '';
        current.latencyMs = Math.max(0, Math.floor(Number(result.latencyMs) || 0));
        current.detectedIp = String(result.detectedIp || '').trim();
        current.detectedCountryCode = String(result.detectedCountryCode || '').trim().toUpperCase();
        current.detectedCountryName = String(result.detectedCountryName || '').trim();
        current.detectedRegion = String(result.detectedRegion || '').trim();
        if (current.detectedCountryCode) {
          current.countryCode = current.detectedCountryCode;
        }
        current.lastCheckedAt = Date.now();
        validated.push(current);
      }

      return {
        validated,
        clashConfigured: false,
      };
    }

    async function probeNodeDelayViaClash(node, clashConfig, options = {}) {
      const timeoutMs = Math.max(1500, Math.min(20000, Number(options.timeoutMs) || 5000));
      const delayUrl = normalizeClashDelayTestUrl(options.testUrl || clashConfig.delayTestUrl || PROXY_TEST_URL);
      const name = encodeURIComponent(String(node.clashName || node.name || '').trim());
      const query = `url=${encodeURIComponent(delayUrl)}&timeout=${timeoutMs}`;
      const startedAt = Date.now();
      try {
        const data = await requestClashApi(`/proxies/${name}/delay?${query}`, clashConfig, {
          method: 'GET',
          timeoutMs: timeoutMs + 3000,
        });
        const delay = Math.max(1, Math.floor(Number(data?.delay) || 0));
        if (!delay) {
          return {
            ok: false,
            latencyMs: Math.max(1, Date.now() - startedAt),
            error: 'Clash 返回空延迟',
          };
        }
        return {
          ok: true,
          latencyMs: delay,
          error: '',
        };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Math.max(1, Date.now() - startedAt),
          error: error?.message || String(error || 'unknown_error'),
        };
      }
    }

    async function validateNodesViaClash(nodes = [], state = {}, options = {}) {
      const probeLimit = Math.max(1, Math.min(300, Number(options.probeLimit) || 80));
      const probeNodes = dedupeClashProxyNames(nodes).slice(0, probeLimit);
      if (!probeNodes.length) {
        return {
          validated: [],
          clashConfigured: false,
        };
      }

      const clashConfigOptions = {
        clashControlUrl: options.clashControlUrl,
        clashSecret: options.clashSecret,
        clashProxyHost: options.clashProxyHost,
        clashMixedPort: options.clashMixedPort,
        clashSelectorGroup: options.clashSelectorGroup,
        clashDelayTestUrl: options.clashDelayTestUrl,
      };
      let configured = null;
      try {
        configured = await applyClashManagedConfig(probeNodes, state, {
          ...clashConfigOptions,
          timeoutMs: options.requestTimeoutMs || options.timeoutMs,
        });
      } catch (error) {
        if (!isClashManagedConfigWriteFailure(error)) {
          throw error;
        }
        const clashConfig = resolveClashBridgeConfig(state, clashConfigOptions);
        const errorMessage = error?.message || String(error || 'unknown_error');
        const checkedAt = Date.now();
        await addLog(
          `代理节点：检测到系统 ClashX 桥接模式，跳过写入 Clash 配置（${errorMessage}）。浏览器将直接桥接到 ${clashConfig.proxyHost}:${clashConfig.mixedPort}，节点请在 ClashX 内管理。`,
          'warn'
        );
        return {
          validated: probeNodes.map((node) => ({
            ...node,
            usable: false,
            status: 'bridge_only',
            validationError: '系统 ClashX 桥接模式：未由扩展托管 Clash 配置。',
            latencyMs: 0,
            detectedIp: '',
            detectedCountryCode: '',
            detectedCountryName: '',
            detectedRegion: '',
            lastCheckedAt: checkedAt,
          })),
          clashConfigured: false,
          clashBridgeOnly: true,
          clashConfig,
          warning: errorMessage,
        };
      }
      if (!configured?.ok) {
        throw new Error(configured?.error || '写入 Clash 配置失败。');
      }

      const concurrency = Math.max(2, Math.min(16, Number(options.probeConcurrency) || 8));
      const checkedNodes = await runConcurrent(concurrency, probeNodes, async (node) => {
        const result = await probeNodeDelayViaClash(node, configured.clashConfig, {
          timeoutMs: options.timeoutMs,
          testUrl: options.clashDelayTestUrl || options.testUrl,
        });
        return {
          ...node,
          usable: Boolean(result.ok),
          status: result.ok ? 'usable' : 'unreachable',
          validationError: result.error || '',
          latencyMs: Math.max(0, Math.floor(Number(result.latencyMs) || 0)),
          detectedIp: '',
          detectedCountryCode: '',
          detectedCountryName: '',
          detectedRegion: '',
          lastCheckedAt: Date.now(),
        };
      });

      return {
        validated: checkedNodes,
        clashConfigured: true,
        clashConfig: configured.clashConfig,
      };
    }

    function summarizeNodes(result = {}) {
      const allNodes = Array.isArray(result.allNodes) ? result.allNodes : [];
      const candidates = Array.isArray(result.candidates) ? result.candidates : [];
      const validated = Array.isArray(result.validated) ? result.validated : [];
      const usableNodes = Array.isArray(result.usableNodes) ? result.usableNodes : [];
      const backend = normalizeProxyBackend(result.backend || DEFAULT_PROXY_BACKEND);
      const supportedCount = backend === PROXY_BACKEND_CLASH
        ? allNodes.filter((item) => item.clashSupported).length
        : allNodes.filter((item) => item.scheme).length;
      const usableLatencies = usableNodes
        .map((item) => Number(item?.latencyMs) || 0)
        .filter((value) => Number.isFinite(value) && value > 0);

      const avgLatencyMs = usableLatencies.length
        ? Math.round(usableLatencies.reduce((sum, value) => sum + value, 0) / usableLatencies.length)
        : 0;

      return {
        total: allNodes.length,
        supported: supportedCount,
        probeCandidates: candidates.length,
        validated: validated.length,
        usable: usableNodes.length,
        dropped: allNodes.length - usableNodes.length,
        avgLatencyMs,
        minLatencyMs: usableLatencies.length ? Math.min(...usableLatencies) : 0,
        maxLatencyMs: usableLatencies.length ? Math.max(...usableLatencies) : 0,
      };
    }

    function getNodeById(state = {}, nodeId = '') {
      const targetId = normalizeProxyNodeId(nodeId);
      if (!targetId) return null;
      const nodes = normalizeProxyNodesForStorage(state.proxyNodes);
      return nodes.find((node) => node.id === targetId) || null;
    }

    function getUsableNodesForBackend(state = {}, backend = resolveProxyBackendForState(state)) {
      const nodes = normalizeProxyNodesForStorage(state.proxyNodes);
      if (backend === PROXY_BACKEND_CLASH) {
        return nodes.filter((node) => node.usable && node.clashSupported);
      }
      return nodes.filter((node) => node.usable && node.scheme);
    }

    function shouldEnableClashNodeRotation(state = {}, options = {}) {
      const ignoreAutoRefresh = Boolean(options?.ignoreAutoRefresh);
      if (!ignoreAutoRefresh && !Boolean(state?.proxyAutoRefreshEnabled)) {
        return false;
      }
      if (resolveProxyBackendForState(state) !== PROXY_BACKEND_CLASH) {
        return false;
      }
      if (normalizeProxyMode(state?.proxyMode) === 'off') {
        return false;
      }
      const usableNodes = getUsableNodesForBackend(state, PROXY_BACKEND_CLASH);
      return usableNodes.length > 1;
    }

    function resolveHeroSmsNodeForState(state = {}) {
      const smsNodeId = normalizeProxyNodeId(state.proxySmsNodeId);
      const selectedNodeId = normalizeProxyNodeId(state.proxySelectedNodeId);

      if (smsNodeId) {
        const match = getNodeById(state, smsNodeId);
        if (match) return match;
      }

      if (selectedNodeId) {
        const match = getNodeById(state, selectedNodeId);
        if (match) return match;
      }

      const nodes = normalizeProxyNodesForStorage(state.proxyNodes);
      return nodes.find((node) => node.usable) || null;
    }

    function checkHeroSmsNodeRegion(state = {}, node = null) {
      if (!node) {
        return { compatible: false, error: '未找到可用于 HeroSMS 的代理节点。', expectedCountry: '', nodeCountry: '' };
      }

      const expectedCountry = getHeroSmsCountryIso2(state.heroSmsCountry);
      const nodeCountry = String(node.countryCode || '').trim().toUpperCase();
      if (!expectedCountry) {
        return {
          compatible: true,
          expectedCountry: '',
          nodeCountry,
          warning: '无法从 HeroSMS 国家 ID 映射到 ISO2，将跳过地区一致性检查。',
        };
      }

      if (!nodeCountry) {
        return {
          compatible: false,
          expectedCountry,
          nodeCountry,
          error: `无法识别代理节点「${node.name}」的地区，无法确保与 HeroSMS 国家一致。`,
        };
      }

      if (expectedCountry !== nodeCountry) {
        return {
          compatible: false,
          expectedCountry,
          nodeCountry,
          error: `HeroSMS 国家(${expectedCountry}) 与接码代理地区(${nodeCountry})不一致。`,
        };
      }

      return { compatible: true, expectedCountry, nodeCountry };
    }

    async function applyProxySettingsFromState(stateInput = null, options = {}) {
      if (!chrome?.proxy?.settings) {
        return {
          mode: 'off',
          applied: false,
          reason: 'proxy_api_unavailable',
        };
      }

      const state = stateInput || (typeof getState === 'function' ? await getState() : {});
      const mode = normalizeProxyMode(state.proxyMode);
      const backend = resolveProxyBackendForState(state, options);

      if (mode === 'off') {
        await withProxyLock(async () => {
          await clearProxySettingsValue();
        });
        return {
          mode,
          backend,
          applied: false,
          reason: options.reason || 'off',
        };
      }

      const selectedNode = getNodeById(state, state.proxySelectedNodeId);
      let config = null;
      if (backend === PROXY_BACKEND_CLASH) {
        const clashConfig = resolveClashBridgeConfig(state, options);
        const selectorGroup = normalizeClashSelectorGroup(clashConfig.selectorGroup);
        const targetName = String(selectedNode?.clashName || selectedNode?.name || '').trim();
        if (targetName) {
          try {
            await updateClashSelector(clashConfig, selectorGroup, targetName, {
              timeoutMs: options.timeoutMs || 10000,
            });
          } catch (error) {
            await addLog(
              `Clash 桥接：无法切换 ClashX 选择组「${selectorGroup}」到「${targetName}」，将保持 ClashX 当前节点并继续桥接本地端口：${error?.message || error}`,
              'warn'
            );
          }
          await patchClashMode(clashConfig, mode === 'global' ? 'global' : 'rule', {
            timeoutMs: options.timeoutMs || 10000,
          }).catch(() => {});
        }
        config = buildChromeProxyConfigForClash(clashConfig, {
          mode,
          ruleDomains: state.proxyRuleDomains,
        });
      } else {
        if (!selectedNode || !selectedNode.usable) {
          await withProxyLock(async () => {
            await clearProxySettingsValue();
          });
          await addLog('代理模式已启用，但未选择可用节点，已回退到系统直连。', 'warn');
          return { mode: 'off', backend, applied: false, reason: 'missing_selected_node' };
        }
        config = buildChromeProxyConfigForNode(selectedNode, {
          mode,
          ruleDomains: state.proxyRuleDomains,
        });
      }

      await withProxyLock(async () => {
        await setProxySettingsValue(config);
      });

      return {
        mode,
        backend,
        applied: true,
        nodeId: selectedNode?.id || '',
        nodeName: selectedNode?.name || '',
        bridgeOnly: backend === PROXY_BACKEND_CLASH && !selectedNode,
      };
    }

    async function rotateToNextClashNode(options = {}) {
      const trigger = String(options.trigger || 'manual').trim() || 'manual';
      const ignoreAutoRefresh = Boolean(options?.ignoreAutoRefresh);

      if (refreshInFlight) {
        return {
          ok: false,
          skipped: true,
          reason: 'refresh_in_flight',
          trigger,
        };
      }

      const state = typeof getState === 'function' ? await getState() : {};
      if (!shouldEnableClashNodeRotation(state, { ignoreAutoRefresh })) {
        return {
          ok: false,
          skipped: true,
          reason: 'rotation_disabled',
          trigger,
        };
      }

      const usableNodes = getUsableNodesForBackend(state, PROXY_BACKEND_CLASH);
      if (usableNodes.length < 2) {
        return {
          ok: false,
          skipped: true,
          reason: 'insufficient_nodes',
          trigger,
        };
      }

      const currentSelectedId = normalizeProxyNodeId(state.proxySelectedNodeId);
      const currentIndex = usableNodes.findIndex((node) => node.id === currentSelectedId);
      const nextIndex = (currentIndex + 1 + usableNodes.length) % usableNodes.length;
      const nextNode = usableNodes[nextIndex];
      if (!nextNode) {
        return {
          ok: false,
          skipped: true,
          reason: 'no_next_node',
          trigger,
        };
      }

      if (nextNode.id === currentSelectedId) {
        return {
          ok: false,
          skipped: true,
          reason: 'same_node',
          trigger,
        };
      }

      const updates = {
        proxySelectedNodeId: nextNode.id,
      };
      if (!normalizeProxyNodeId(state.proxySmsNodeId)) {
        updates.proxySmsNodeId = nextNode.id;
      }

      if (typeof setPersistentSettings === 'function') {
        await setPersistentSettings(updates);
      }
      if (typeof setState === 'function') {
        await setState(updates);
      }
      if (typeof broadcastDataUpdate === 'function') {
        broadcastDataUpdate(updates);
      }

      const nextState = typeof getState === 'function'
        ? await getState()
        : { ...state, ...updates };

      await applyProxySettingsFromState(nextState, {
        reason: `clash_rotate_${trigger}`,
        backend: PROXY_BACKEND_CLASH,
        clashControlUrl: nextState.clashControlUrl,
        clashSecret: nextState.clashSecret,
        clashProxyHost: nextState.clashProxyHost,
        clashMixedPort: nextState.clashMixedPort,
        clashSelectorGroup: nextState.clashSelectorGroup,
        clashDelayTestUrl: nextState.clashDelayTestUrl,
      });

      await addLog(`Clash 节点自动轮询：已切换到 ${nextNode.name}（${nextIndex + 1}/${usableNodes.length}）`, 'info');

      return {
        ok: true,
        trigger,
        nodeId: nextNode.id,
        nodeName: nextNode.name,
        index: nextIndex,
        total: usableNodes.length,
        state: nextState,
      };
    }

    async function refreshProxyNodes(options = {}) {
      if (refreshInFlight) {
        return refreshInFlight;
      }

      const task = (async () => {
        const trigger = String(options.trigger || 'manual').trim() || 'manual';
        try {
          const currentState = typeof getState === 'function' ? await getState() : {};
          const backend = resolveProxyBackendForState(currentState, options);
          const workingState = {
            ...currentState,
            proxyBackend: backend,
            clashControlUrl: options.clashControlUrl ?? currentState.clashControlUrl,
            clashSecret: options.clashSecret ?? currentState.clashSecret,
            clashProxyHost: options.clashProxyHost ?? currentState.clashProxyHost,
            clashMixedPort: options.clashMixedPort ?? currentState.clashMixedPort,
            clashSelectorGroup: options.clashSelectorGroup ?? currentState.clashSelectorGroup,
            clashDelayTestUrl: options.clashDelayTestUrl ?? currentState.clashDelayTestUrl,
            cliproxyEnabled: options.cliproxyEnabled ?? currentState.cliproxyEnabled,
            cliproxyHost: options.cliproxyHost ?? currentState.cliproxyHost,
            cliproxyPort: options.cliproxyPort ?? currentState.cliproxyPort,
            cliproxyType: options.cliproxyType ?? currentState.cliproxyType,
            cliproxyUsername: options.cliproxyUsername ?? currentState.cliproxyUsername,
            cliproxyPassword: options.cliproxyPassword ?? currentState.cliproxyPassword,
            proxyValidationUrl: options.proxyValidationUrl ?? currentState.proxyValidationUrl,
          };
          await addLog(`代理节点：开始同步 ${DEFAULT_PROXY_NODE_SOURCE_REPO} 最新节点...`, 'info');
          const source = await fetchLatestClashSource(options.repo || DEFAULT_PROXY_NODE_SOURCE_REPO, {
            timeoutMs: options.requestTimeoutMs,
          });
          const parsed = parseClashProxyFile(source.rawText);
          const allNodes = parsed
            .map((node, index) => normalizeProxyNode(node, index, source.fileName))
            .filter(Boolean);
          const cliproxyNode = buildCliproxyNodeFromState(workingState, source.fileName, allNodes.length);
          if (cliproxyNode) {
            allNodes.unshift(cliproxyNode);
          }
          const probeCandidates = backend === PROXY_BACKEND_CLASH
            ? allNodes.filter((node) => node.clashSupported)
            : allNodes.filter((node) => node.scheme);
          const validationResult = backend === PROXY_BACKEND_CLASH
            ? await validateNodesViaClash(probeCandidates, workingState, {
              timeoutMs: options.timeoutMs,
              requestTimeoutMs: options.requestTimeoutMs,
              testUrl: options.clashDelayTestUrl || options.testUrl,
              probeLimit: options.probeLimit,
              clashControlUrl: options.clashControlUrl,
              clashSecret: options.clashSecret,
              clashProxyHost: options.clashProxyHost,
              clashMixedPort: options.clashMixedPort,
              clashSelectorGroup: options.clashSelectorGroup,
              clashDelayTestUrl: options.clashDelayTestUrl,
            })
            : await validateNodesViaBrowser(probeCandidates, {
              timeoutMs: options.timeoutMs,
              testUrl: options.testUrl || workingState.proxyValidationUrl,
              probeLimit: options.probeLimit,
            });
          const validated = Array.isArray(validationResult?.validated) ? validationResult.validated : [];
          const usableNodes = validated
            .filter((item) => item.usable)
            .sort((left, right) => {
              const leftLatency = Number(left.latencyMs) || Number.MAX_SAFE_INTEGER;
              const rightLatency = Number(right.latencyMs) || Number.MAX_SAFE_INTEGER;
              return leftLatency - rightLatency;
            });
          const nodesForStorage = validationResult?.clashBridgeOnly
            ? validated
            : usableNodes;
          const summary = summarizeNodes({
            allNodes,
            candidates: probeCandidates,
            validated,
            usableNodes,
            backend,
          });
          let proxySelectedNodeId = normalizeProxyNodeId(currentState.proxySelectedNodeId);
          if (!nodesForStorage.some((item) => item.id === proxySelectedNodeId)) {
            proxySelectedNodeId = nodesForStorage[0]?.id || '';
          }

          let proxySmsNodeId = normalizeProxyNodeId(currentState.proxySmsNodeId);
          if (!nodesForStorage.some((item) => item.id === proxySmsNodeId)) {
            proxySmsNodeId = proxySelectedNodeId;
          }

          const updates = {
            proxyNodes: nodesForStorage,
            proxyNodeLastRefreshAt: Date.now(),
            proxyNodeSourceRepo: source.repo,
            proxyNodeSourceFile: source.fileName,
            proxyNodeLastError: '',
            proxySelectedNodeId,
            proxySmsNodeId,
            proxyBackend: backend,
            clashControlUrl: normalizeClashControlUrl(workingState.clashControlUrl),
            clashSecret: String(workingState.clashSecret || '').trim(),
            clashProxyHost: normalizeClashProxyHost(workingState.clashProxyHost),
            clashMixedPort: normalizeClashMixedPort(workingState.clashMixedPort),
            clashSelectorGroup: normalizeClashSelectorGroup(workingState.clashSelectorGroup),
            clashDelayTestUrl: normalizeClashDelayTestUrl(workingState.clashDelayTestUrl),
            cliproxyEnabled: Boolean(workingState.cliproxyEnabled),
            cliproxyHost: normalizeCliproxyHost(workingState.cliproxyHost),
            cliproxyPort: normalizeCliproxyPort(workingState.cliproxyPort),
            cliproxyType: normalizeCliproxyType(workingState.cliproxyType),
            cliproxyUsername: String(workingState.cliproxyUsername || '').trim(),
            cliproxyPassword: String(workingState.cliproxyPassword || '').trim(),
            proxyValidationUrl: normalizeProxyValidationUrl(workingState.proxyValidationUrl),
          };

          if (typeof setPersistentSettings === 'function') {
            await setPersistentSettings(updates);
          }
          if (typeof setState === 'function') {
            await setState(updates);
          }
          if (typeof broadcastDataUpdate === 'function') {
            broadcastDataUpdate(updates);
          }

          const nextState = typeof getState === 'function'
            ? await getState()
            : { ...currentState, ...updates };

          await ensureProxyRefreshAlarm(nextState).catch(() => {});

          await applyProxySettingsFromState(nextState, {
            reason: `node_refresh_${trigger}`,
            backend,
            clashControlUrl: updates.clashControlUrl,
            clashSecret: updates.clashSecret,
            clashProxyHost: updates.clashProxyHost,
            clashMixedPort: updates.clashMixedPort,
            clashSelectorGroup: updates.clashSelectorGroup,
            clashDelayTestUrl: updates.clashDelayTestUrl,
          }).catch(() => {});

          await addLog(`代理节点：同步完成，总数 ${summary.total}，支持类型 ${summary.supported}，探测 ${summary.validated}，可用 ${summary.usable}，平均延迟 ${summary.avgLatencyMs || 0}ms。`, 'ok');

          return {
            ok: true,
            trigger,
            sourceFile: source.fileName,
            sourceRepo: source.repo,
            summary,
            state: nextState,
          };
        } catch (error) {
          const errorMessage = error?.message || String(error || 'unknown_error');
          const updates = {
            proxyNodeLastError: errorMessage,
            proxyNodeLastRefreshAt: Date.now(),
          };
          if (typeof setPersistentSettings === 'function') {
            await setPersistentSettings(updates).catch(() => {});
          }
          if (typeof setState === 'function') {
            await setState(updates).catch(() => {});
          }
          if (typeof broadcastDataUpdate === 'function') {
            broadcastDataUpdate(updates);
          }
          await addLog(`代理节点：同步失败：${errorMessage}`, 'error');
          return {
            ok: false,
            error: errorMessage,
            trigger,
          };
        }
      })();

      refreshInFlight = task.finally(() => {
        refreshInFlight = null;
      });

      return refreshInFlight;
    }

    async function ensureProxyRefreshAlarm(stateInput = null) {
      if (!chrome?.alarms) {
        return;
      }

      const state = stateInput || (typeof getState === 'function' ? await getState() : {});
      const enabled = Boolean(state.proxyAutoRefreshEnabled);

      if (!enabled) {
        await chrome.alarms.clear(PROXY_NODE_REFRESH_ALARM_NAME);
        await chrome.alarms.clear(PROXY_NODE_ROTATE_ALARM_NAME);
        return;
      }

      const existingRefresh = await chrome.alarms.get(PROXY_NODE_REFRESH_ALARM_NAME);
      if (!existingRefresh) {
        await chrome.alarms.create(PROXY_NODE_REFRESH_ALARM_NAME, {
          delayInMinutes: 60,
          periodInMinutes: 24 * 60,
        });
      }

      if (!shouldEnableClashNodeRotation(state)) {
        await chrome.alarms.clear(PROXY_NODE_ROTATE_ALARM_NAME);
        return;
      }

      const existingRotate = await chrome.alarms.get(PROXY_NODE_ROTATE_ALARM_NAME);
      if (existingRotate) {
        return;
      }

      const intervalMinutes = Math.max(
        2,
        Math.min(60, Math.floor(Number(state?.clashNodeRotateIntervalMinutes) || CLASH_NODE_ROTATE_INTERVAL_MINUTES))
      );
      await chrome.alarms.create(PROXY_NODE_ROTATE_ALARM_NAME, {
        delayInMinutes: intervalMinutes,
        periodInMinutes: intervalMinutes,
      });
    }

    async function handleAlarm(alarmName) {
      if (alarmName !== PROXY_NODE_REFRESH_ALARM_NAME) {
        if (alarmName === PROXY_NODE_ROTATE_ALARM_NAME) {
          await rotateToNextClashNode({ trigger: 'alarm' });
          return true;
        }
        return false;
      }

      await refreshProxyNodes({ trigger: 'alarm' });
      return true;
    }

    async function withTemporaryNodeProxy(nodeOrId, task, options = {}) {
      if (typeof task !== 'function') {
        throw new Error('withTemporaryNodeProxy 缺少可执行任务。');
      }

      const state = typeof getState === 'function' ? await getState() : {};
      const backend = resolveProxyBackendForState(state, options);
      const node = typeof nodeOrId === 'string'
        ? getNodeById(state, nodeOrId)
        : nodeOrId;

      if (!node) {
        throw new Error('未找到临时代理节点。');
      }

      if (backend !== PROXY_BACKEND_CLASH && !chrome?.proxy?.settings) {
        return task(node);
      }

      return withProxyLock(async () => {
        const snapshot = chrome?.proxy?.settings ? await getCurrentProxySettings() : null;
        try {
          if (backend === PROXY_BACKEND_CLASH) {
            const clashConfig = resolveClashBridgeConfig(state, options);
            const selectorGroup = normalizeClashSelectorGroup(clashConfig.selectorGroup);
            const previousNode = getNodeById(state, state.proxySelectedNodeId);
            const previousName = String(previousNode?.clashName || previousNode?.name || '').trim();
            const targetName = String(node.clashName || node.name || '').trim();
            if (!targetName) {
              throw new Error('临时节点缺少 Clash 节点名称。');
            }
            await updateClashSelector(clashConfig, selectorGroup, targetName, {
              timeoutMs: options.timeoutMs || 10000,
            });
            if (chrome?.proxy?.settings) {
              const clashProxyConfig = buildChromeProxyConfigForClash(clashConfig, {
                mode: 'global',
                ruleDomains: options.ruleDomains,
              });
              await setProxySettingsValue(clashProxyConfig);
            }
            try {
              return await task(node);
            } finally {
              if (previousName && previousName !== targetName) {
                await updateClashSelector(clashConfig, selectorGroup, previousName, {
                  timeoutMs: options.timeoutMs || 10000,
                }).catch(() => {});
              }
            }
          }

          const config = buildChromeProxyConfigForNode(node, {
            mode: normalizeProxyMode(options.mode || 'global'),
            ruleDomains: options.ruleDomains,
          });
          await setProxySettingsValue(config);
          return await task(node);
        } finally {
          await restoreProxySettings(snapshot).catch(() => {});
        }
      });
    }

    return {
      applyProxySettingsFromState,
      buildChromeProxyConfigForNode,
      checkHeroSmsNodeRegion,
      ensureProxyRefreshAlarm,
      fetchLatestClashSource,
      getHeroSmsCountryIso2,
      getNodeById,
      handleAlarm,
      normalizeHeroSmsCountry,
      normalizeProxyMode,
      normalizeProxyNodeId,
      normalizeProxyNodesForStorage,
      normalizeProxyRuleDomains,
      parseClashProxyFile,
      refreshProxyNodes,
      rotateToNextClashNode,
      resolveHeroSmsNodeForState,
      withTemporaryNodeProxy,
    };
  }

  return {
    createProxyNodeManager,
  };
});
