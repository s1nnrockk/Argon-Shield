/* Firefox MV3 automatic public-proxy manager.
 * Public proxies are untrusted and unstable. Failover reacts to Firefox proxy errors;
 * the extension does not claim a candidate is healthy until real traffic succeeds.
 */
const api = globalThis.browser;
const DEFAULTS = {
  enabled: false,
  autoProxy: true,
  host: "",
  port: 8080,
  protocol: "HTTP",
  mode: "all",
  domains: "",
  autoStart: false,
  notifyIp: false
};
const PROXY_FEEDS = [
  "https://cdn.jsdelivr.net/gh/ProxyScrape/free-proxy-list@main/proxies/protocols/http/data.txt"
];
const REFRESH_ALARM = "argon-proxy-refresh";
const IP_ALARM = "argon-ip-check";
let config = { ...DEFAULTS };
let candidates = [];
let activeIndex = -1;
let lastKnownIp = null;
let lastProxyError = "";
let lastSuccessAt = 0;
let refreshing = null;

function normalizeDomain(line) {
  return line.trim().toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/.*$/, "").replace(/^\\*\\./, "");
}
function getDomains() {
  return String(config.domains || "").split(/[\\n,;]+/).map(normalizeDomain).filter(Boolean);
}
function matchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}
function shouldProxy(urlString) {
  if (!config.enabled) return false;
  let url;
  try { url = new URL(urlString); } catch { return false; }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || !host.includes(".")) return false;
  if (config.autoProxy) return candidates.length > 0 && activeIndex >= 0;
  if (!config.host || !Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535) return false;
  const listed = getDomains().some(domain => matchesDomain(host, domain));
  if (config.mode === "blacklist" && listed) return false;
  if (config.mode === "whitelist" && !listed) return false;
  return true;
}
function proxyForRequest(details) {
  if (!shouldProxy(details.url)) return { type: "direct" };
  if (config.autoProxy) {
    const candidate = candidates[activeIndex];
    if (!candidate) return { type: "direct" };
    return { type: "http", host: candidate.host, port: candidate.port };
  }
  const protocol = String(config.protocol || "HTTP").toUpperCase();
  const host = String(config.host).trim();
  const port = Number(config.port);
  if (protocol === "SOCKS5") return { type: "socks", host, port, proxyDNS: true, socksVersion: 5 };
  if (protocol === "HTTPS") return { type: "https", host, port };
  return { type: "http", host, port };
}
async function loadConfig() {
  const stored = await api.storage.sync.get(DEFAULTS);
  config = { ...DEFAULTS, ...stored };
}
async function notify(title, message) {
  try {
    await api.notifications.create({
      type: "basic",
      iconUrl: api.runtime.getURL("icon.svg"),
      title,
      message
    });
  } catch (error) {
    console.warn("Argon Shield notification failed:", error);
  }
}
async function fetchCandidates() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const found = new Map();
    for (const feed of PROXY_FEEDS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const response = await fetch(feed, { cache: "no-store", signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) throw new Error("Proxy list HTTP " + response.status);
        const body = await response.text();
        for (const line of body.split(/\\r?\\n/)) {
          const match = line.trim().match(/^(?:http:\\/\\/)?((?:\\d{1,3}\\.){3}\\d{1,3}):(\\d{1,5})$/i);
          if (!match) continue;
          const host = match[1];
          const port = Number(match[2]);
          if (port < 1 || port > 65535) continue;
          const octets = host.split(".").map(Number);
          if (octets.some(n => n < 0 || n > 255)) continue;
          found.set(host + ":" + port, { host, port });
        }
      } catch (error) {
        console.warn("Argon Shield proxy feed failed:", error);
      }
    }
    const previous = activeIndex >= 0 ? candidates[activeIndex] : null;
    candidates = [...found.values()];
    if (previous) {
      const same = candidates.findIndex(item => item.host === previous.host && item.port === previous.port);
      activeIndex = same;
    }
    if (activeIndex < 0 && candidates.length) activeIndex = Math.floor(Math.random() * candidates.length);
    if (!candidates.length) activeIndex = -1;
    return candidates.length;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function refreshProxyList() {
  await loadConfig();
  const oldCount = candidates.length;
  const count = await fetchCandidates();
  if (config.enabled && config.autoProxy && activeIndex < 0 && count > 0) {
    activeIndex = 0;
  }
  if (config.enabled && config.autoProxy && count === 0) {
    await notify("Argon Shield", "Не удалось получить список прокси. Повторная попытка будет позже.");
  } else if (config.enabled && config.autoProxy && oldCount === 0 && count > 0) {
    await notify("Argon Shield", "Получен список прокси (" + count + "). Надёжность проверяется по результатам реальных запросов.");
  }
}
function rotateProxy(reason = "Ошибка прокси") {
  if (!candidates.length) {
    activeIndex = -1;
    lastProxyError = reason;
    return;
  }
  const old = candidates[activeIndex];
  activeIndex = (activeIndex + 1) % candidates.length;
  const next = candidates[activeIndex];
  lastProxyError = reason;
  if (old && next && (old.host !== next.host || old.port !== next.port)) {
    console.warn("Argon Shield switching proxy after error:", reason, "->", next.host + ":" + next.port);
  }
}
async function checkIp() {
  if (!config.enabled || !config.notifyIp) return;
  try {
    const response = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.ip) return;
    if (lastKnownIp && lastKnownIp !== data.ip) {
      await notify("Argon Shield · IP changed", "Detected public IP change: " + lastKnownIp + " → " + data.ip);
    }
    lastKnownIp = data.ip;
  } catch (error) {
    console.warn("Argon Shield IP check failed:", error);
  }
}

api.proxy.onRequest.addListener(proxyForRequest, { urls: ["<all_urls>"] });
if (api.proxy.onError) {
  api.proxy.onError.addListener(error => {
    const message = typeof error === "string" ? error : (error?.message || "Proxy request failed");
    if (config.enabled && config.autoProxy) rotateProxy(message);
    else lastProxyError = message;
  });
}
api.webRequest?.onCompleted?.addListener(details => {
  if (details.url && details.url.startsWith("http") && config.enabled && config.autoProxy) lastSuccessAt = Date.now();
}, { urls: ["http://*/*", "https://*/*"] });
api.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync") return;
  await loadConfig();
  if (changes.enabled || changes.autoProxy) {
    if (config.enabled && config.autoProxy) await refreshProxyList();
  }
  if (changes.enabled || changes.notifyIp || changes.host || changes.port || changes.protocol) {
    if (config.enabled && config.notifyIp) await checkIp();
  }
});
api.runtime.onInstalled.addListener(async () => {
  await loadConfig();
  api.alarms.create(REFRESH_ALARM, { periodInMinutes: 15 });
  api.alarms.create(IP_ALARM, { periodInMinutes: 5 });
  if (config.autoStart) await api.storage.sync.set({ enabled: true });
  if (config.enabled && config.autoProxy) await refreshProxyList();
});
api.runtime.onStartup.addListener(async () => {
  await loadConfig();
  if (config.autoStart && !config.enabled) await api.storage.sync.set({ enabled: true });
  api.alarms.create(REFRESH_ALARM, { periodInMinutes: 15 });
  api.alarms.create(IP_ALARM, { periodInMinutes: 5 });
  if (config.enabled && config.autoProxy) await refreshProxyList();
  await checkIp();
});
api.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM) refreshProxyList();
  if (alarm.name === IP_ALARM) checkIp();
});
api.runtime.onMessage.addListener(async message => {
  if (message?.type === "GET_STATUS") {
    await loadConfig();
    return {
      enabled: config.enabled,
      autoProxy: config.autoProxy,
      configured: config.autoProxy ? candidates.length > 0 : Boolean(config.host && config.port),
      protocol: config.autoProxy ? "AUTO HTTP" : config.protocol,
      host: config.autoProxy ? (candidates[activeIndex]?.host || "") : config.host,
      port: config.autoProxy ? (candidates[activeIndex]?.port || 0) : config.port,
      mode: config.mode,
      candidateCount: candidates.length,
      lastProxyError,
      lastSuccessAt
    };
  }
  if (message?.type === "REFRESH_PROXIES") {
    await refreshProxyList();
    return { ok: candidates.length > 0, count: candidates.length };
  }
  if (message?.type === "SET_ENABLED") {
    await loadConfig();
    if (message.enabled && config.autoProxy) {
      await refreshProxyList();
      if (!candidates.length) return { ok: false, error: "Не удалось загрузить список прокси. Попробуй позже." };
    } else if (message.enabled && (!config.host || !Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535)) {
      return { ok: false, error: "Сначала укажи корректный адрес и порт прокси в настройках." };
    }
    config.enabled = Boolean(message.enabled);
    await api.storage.sync.set({ enabled: config.enabled });
    if (config.enabled && config.notifyIp) await checkIp();
    return { ok: true, enabled: config.enabled };
  }
});
loadConfig().then(async () => {
  if (config.enabled && config.autoProxy) await refreshProxyList();
}).catch(console.error);
