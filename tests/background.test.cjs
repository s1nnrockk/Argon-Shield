const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function makeEvent() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    async emit(...args) { return Promise.all(listeners.map(fn => fn(...args))); },
    get first() { return listeners[0]; }
  };
}
const data = {
  enabled: true, host: "proxy.example.test", port: 3128, protocol: "HTTP",
  mode: "all", domains: "", autoStart: false, notifyIp: false
};
const storageChanged = makeEvent();
const proxyRequest = makeEvent();
const proxyError = makeEvent();
const runtimeMessage = makeEvent();
const alarms = makeEvent();
const installed = makeEvent();
const startup = makeEvent();
const createdNotifications = [];
const api = {
  proxy: { onRequest: proxyRequest, onError: proxyError },
  storage: {
    sync: {
      async get(defaults) { return { ...defaults, ...data }; },
      async set(values) {
        const changes = {};
        for (const [key, newValue] of Object.entries(values)) {
          changes[key] = { oldValue: data[key], newValue };
          data[key] = newValue;
        }
        await storageChanged.emit(changes, "sync");
      }
    },
    onChanged: storageChanged
  },
  notifications: { async create(options) { createdNotifications.push(options); } },
  runtime: {
    onMessage: runtimeMessage, onInstalled: installed, onStartup: startup,
    getURL(path) { return "moz-extension://test/" + path; }
  },
  alarms: { create() {}, onAlarm: alarms }
};
const source = fs.readFileSync("background.js", "utf8");
vm.runInNewContext(source, { browser: api, console, URL, fetch: async () => ({ ok: true, json: async () => ({ ip: "198.51.100.10" }) }), Date, Number, String, Boolean, Object, Array, Math });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await wait(0);
  const handler = proxyRequest.first;
  assert.equal(typeof handler, "function");
  assert.deepEqual(JSON.parse(JSON.stringify(handler({ url: "https://example.com/" }))), { type: "http", host: "proxy.example.test", port: 3128 });
  console.log("PASS: HTTP proxy mapping");
  data.protocol = "HTTPS";
  await storageChanged.emit({ protocol: { newValue: "HTTPS" } }, "sync");
  assert.equal(handler({ url: "https://example.com/" }).type, "https");
  console.log("PASS: HTTPS proxy mapping");
  data.protocol = "SOCKS5";
  await storageChanged.emit({ protocol: { newValue: "SOCKS5" } }, "sync");
  const socks = handler({ url: "https://example.com/" });
  assert.equal(socks.type, "socks");
  assert.equal(socks.socksVersion, 5);
  assert.equal(socks.proxyDNS, true);
  console.log("PASS: SOCKS5 mapping and DNS option");
  assert.equal(handler({ url: "http://localhost/" }).type, "direct");
  assert.equal(handler({ url: "http://intranet/" }).type, "direct");
  console.log("PASS: local and single-label hosts bypass proxy");
  data.protocol = "HTTP";
  data.mode = "blacklist";
  data.domains = "example.com";
  await storageChanged.emit({ mode: { newValue: "blacklist" }, domains: { newValue: "example.com" } }, "sync");
  assert.equal(handler({ url: "https://example.com/" }).type, "direct");
  assert.equal(handler({ url: "https://sub.example.com/" }).type, "direct");
  assert.equal(handler({ url: "https://other.com/" }).type, "http");
  console.log("PASS: blacklist domain and subdomain routing");
  data.mode = "whitelist";
  await storageChanged.emit({ mode: { newValue: "whitelist" } }, "sync");
  assert.equal(handler({ url: "https://example.com/" }).type, "http");
  assert.equal(handler({ url: "https://other.com/" }).type, "direct");
  console.log("PASS: whitelist routing");
  const status = await runtimeMessage.first({ type: "GET_STATUS" });
  assert.equal(status.configured, true);
  assert.equal(status.mode, "whitelist");
  console.log("PASS: status message");
  await proxyError.emit({ message: "mock proxy failure" });
  const erroredStatus = await runtimeMessage.first({ type: "GET_STATUS" });
  assert.equal(erroredStatus.lastProxyError, "mock proxy failure");
  console.log("PASS: proxy error diagnostics");
  const disabled = await runtimeMessage.first({ type: "SET_ENABLED", enabled: false });
  assert.equal(disabled.ok, true);
  assert.equal(data.enabled, false);
  console.log("PASS: enable/disable message and storage update");
})().catch(error => { console.error(error); process.exitCode = 1; });
