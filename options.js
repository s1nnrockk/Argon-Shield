const api = globalThis.browser;
const $ = id => document.getElementById(id);
const form = $("settingsForm");
let autoSaveTimer = null;
let toastTimer = null;
const fields = ["host", "port", "protocol", "mode", "domains", "autoStart", "notifyIp"];
function readForm() {
  const portText = $("port").value.trim();
  return {
    host: $("host").value.trim(),
    port: portText === "" ? 8080 : Number(portText),
    protocol: $("protocol").value,
    mode: $("mode").value,
    domains: $("domains").value,
    autoStart: $("autoStart").checked,
    notifyIp: $("notifyIp").checked
  };
}
function validate(settings) {
  if (settings.host && (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535)) {
    $("port").setCustomValidity("Порт должен быть целым числом от 1 до 65535.");
    $("port").reportValidity();
    $("port").setCustomValidity("");
    return false;
  }
  return true;
}
function showToast(message = "✓ Настройки сохранены") {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2400);
}
async function saveSettings(manual = false) {
  const settings = readForm();
  if (!validate(settings)) return false;
  try {
    await api.storage.sync.set(settings);
    $("state").textContent = "Синхронизировано";
    if (manual) showToast();
    return true;
  } catch (error) {
    console.error("Argon Shield save failed:", error);
    $("state").textContent = "Ошибка сохранения — проверь синхронизацию Firefox";
    if (manual) showToast("⚠ Не удалось сохранить настройки");
    return false;
  }
}
async function loadSettings() {
  try {
    const settings = await api.storage.sync.get({
      host: "", port: 8080, protocol: "HTTP", mode: "all", domains: "",
      autoStart: false, notifyIp: false
    });
    $("host").value = settings.host || "";
    $("port").value = settings.port ?? 8080;
    $("protocol").value = settings.protocol || "HTTP";
    $("mode").value = settings.mode || "all";
    $("domains").value = settings.domains || "";
    $("autoStart").checked = Boolean(settings.autoStart);
    $("notifyIp").checked = Boolean(settings.notifyIp);
    $("state").textContent = "Настройки загружены";
  } catch (error) {
    console.error("Argon Shield load failed:", error);
    $("state").textContent = "Не удалось загрузить настройки";
  }
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  await saveSettings(true);
});
form.addEventListener("input", () => {
  $("state").textContent = "Есть несохранённые изменения…";
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveSettings(false), 650);
});
form.addEventListener("change", () => {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveSettings(false), 150);
});
api.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && fields.some(field => Object.prototype.hasOwnProperty.call(changes, field))) {
    $("state").textContent = "Изменения применены";
  }
});
loadSettings();