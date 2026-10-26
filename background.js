/* Firefox MV3 background worker. Firefox uses browser.proxy.onRequest, not Chrome's proxy.settings API. */
const api = globalThis.browser;
const DEFAULTS = {
  enabled: false,
  host: "",
  port: 8080,
  protocol: "HTTP",
  mode: "all", // all | blacklist (listed domains bypass) | whitelist (only listed domains use proxy)
  domains: "",
  autoStart: false,
  notifyIp: false
};
let config = { ...DEFAULTS };
let lastKnownIp = null;

function normalizeDomain(line) {
  return line.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
}
function getDomains() {
  return String(config.domains || "").split(/[\n,;]+/).map(normalizeDomain).filter(Boolean);
}
function matchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}
function shouldProxy(urlString) {
  if (!config.enabled || !config.host || !Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535) return false;
  let url;
  try { url = new URL(urlString); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || !host.includes(".")) return false;
  const listed = getDomains().some(domain => matchesDomain(host, domain));
  if (config.mode === "blacklist" && listed) return false;
  if (config.mode === "whitelist" && !listed) return false;
  return true;
}
function proxyForRequest(details) {
  if (!shouldProxy(details.url)) return { type: "direct" };
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
api.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "sync") return;
  await loadConfig();
  if (changes.enabled || changes.notifyIp || changes.host || changes.port || changes.protocol) {
    if (config.enabled && config.notifyIp) await checkIp();
  }
});
api.runtime.onInstalled.addListener(async () => {
  await loadConfig();
  api.alarms.create("argon-ip-check", { periodInMinutes: 5 });
  if (config.autoStart && config.host && config.port) {
    config.enabled = true;
    await api.storage.sync.set({ enabled: true });
  }
});
api.runtime.onStartup.addListener(async () => {
  await loadConfig();
  if (config.autoStart && config.host && config.port && !config.enabled) {
    config.enabled = true;
    await api.storage.sync.set({ enabled: true });
  }
  api.alarms.create("argon-ip-check", { periodInMinutes: 5 });
  await checkIp();
});
api.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "argon-ip-check") checkIp();
});
api.runtime.onMessage.addListener(async message => {
  if (message?.type === "GET_STATUS") {
    await loadConfig();
    return { enabled: config.enabled, configured: Boolean(config.host && config.port), protocol: config.protocol, host: config.host, port: config.port, mode: config.mode };
  }
  if (message?.type === "SET_ENABLED") {
    await loadConfig();
    if (message.enabled && (!config.host || !Number.isInteger(Number(config.port)) || Number(config.port) < 1 || Number(config.port) > 65535)) {
      return { ok: false, error: "Сначала укажи корректный адрес и порт прокси в настройках." };
    }
    config.enabled = Boolean(message.enabled);
    await api.storage.sync.set({ enabled: config.enabled });
    if (config.enabled && config.notifyIp) await checkIp();
    return { ok: true, enabled: config.enabled };
  }
});
loadConfig().catch(console.error);
