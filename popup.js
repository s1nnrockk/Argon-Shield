const api = globalThis.browser;
const $ = id => document.getElementById(id);
const modeNames = { all: "Все сайты", blacklist: "Список исключений", whitelist: "Только выбранные" };
async function refresh() {
  try {
    const s = await api.runtime.sendMessage({ type: "GET_STATUS" });
    $("status").textContent = s.enabled ? "Прокси включён" : "Прокси выключен";
    $("sub").textContent = s.enabled
      ? (s.lastProxyError ? "Firefox сообщил об ошибке соединения" : "Правила прокси активны; соединение с сервером отдельно не подтверждено")
      : "Настрой сервер, затем включи прокси";
    $("toggle").classList.toggle("on", s.enabled);
    $("toggle").setAttribute("aria-label", s.enabled ? "Выключить прокси" : "Включить прокси");
    $("server").textContent = s.configured ? s.protocol + " · " + s.host + ":" + s.port : "Не настроен";
    $("mode").textContent = modeNames[s.mode] || modeNames.all;
    $("proxyError").textContent = s.lastProxyError ? "Ошибка Firefox: " + s.lastProxyError : "Ошибок прокси от Firefox пока не зарегистрировано";
    $("proxyError").classList.toggle("error", Boolean(s.lastProxyError));
    $("clearError").hidden = !s.lastProxyError;
    $("sub").classList.toggle("error", Boolean(s.lastProxyError));
  } catch (e) {
    $("status").textContent = "Ошибка";
    $("sub").textContent = "Не удалось связаться с фоновым скриптом";
    $("sub").classList.add("error");
  }
}
$("toggle").addEventListener("click", async () => {
  $("toggle").disabled = true;
  try {
    const s = await api.runtime.sendMessage({ type: "GET_STATUS" });
    const result = await api.runtime.sendMessage({ type: "SET_ENABLED", enabled: !s.enabled });
    if (!result?.ok) {
      $("sub").textContent = result?.error || "Не удалось изменить состояние";
      $("sub").classList.add("error");
    }
  } catch (e) {
    $("sub").textContent = "Ошибка управления прокси";
    $("sub").classList.add("error");
  } finally {
    $("toggle").disabled = false;
    await refresh();
  }
});
$("clearError").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "CLEAR_PROXY_ERROR" });
  await refresh();
});
$("settings").addEventListener("click", () => api.runtime.openOptionsPage());
refresh();
