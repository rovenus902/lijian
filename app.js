const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DB_NAME = "page-vault";
const STORE_NAME = "apps";
const PASSWORD_KEY = "page-vault-password";
const SESSION_KEY = "page-vault-unlocked";

const state = {
  apps: [],
  activeApp: null,
  editingId: null,
  deferredInstall: null,
  demo: new URLSearchParams(location.search).has("demo")
};

const palettes = [
  ["#3c4038", "#f5efdf"], ["#243a3c", "#edf0e8"], ["#5a3932", "#f7e8d9"],
  ["#323039", "#f1edf5"], ["#5d553b", "#fff6d8"], ["#293742", "#e9f0f2"],
  ["#6a4a53", "#faeaf0"], ["#354137", "#eaf2e9"], ["#4a423b", "#f2ece5"]
];

const demoApps = [
  { id: "demo-1", title: "夜间手记", subtitle: "私人记录", themeColor: "#323039", icon: "", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), html: "<!doctype html><meta name='viewport' content='width=device-width'><style>body{margin:0;background:#17171b;color:#eee;font:16px system-ui;padding:40px}h1{font:42px Georgia;font-weight:400}p{color:#aaa;line-height:1.8}</style><h1>夜间手记</h1><p>这是一份存进页匣的 HTML。</p>" },
  { id: "demo-2", title: "颜色标本", subtitle: "配色收藏", themeColor: "#5a3932", icon: "", updatedAt: new Date(Date.now() - 3600000).toISOString(), createdAt: new Date().toISOString(), html: "<!doctype html><meta name='viewport' content='width=device-width'><style>body{font-family:system-ui;padding:30px;background:#f1eee6}.c{height:90px;border-radius:20px;margin:15px;background:#5a3932}.c:nth-child(2){background:#243a3c}.c:nth-child(3){background:#d8c9ae}</style><div class=c></div><div class=c></div><div class=c></div>" },
  { id: "demo-3", title: "小小计时器", subtitle: "专注工具", themeColor: "#243a3c", icon: "", updatedAt: new Date(Date.now() - 7200000).toISOString(), createdAt: new Date().toISOString(), html: "<!doctype html><meta name='viewport' content='width=device-width'><style>body{display:grid;place-items:center;height:100vh;margin:0;background:#e9efeb;font-family:system-ui}.t{font:70px Georgia}</style><div class=t>25:00</div>" }
];

function hash(input) {
  let value = 0;
  for (const char of input) value = ((value << 5) - value + char.charCodeAt(0)) | 0;
  return Math.abs(value);
}

function paletteFor(app) {
  if (/^#[0-9a-f]{6}$/i.test(app.themeColor || "")) return [app.themeColor, "#fffaf0"];
  return palettes[hash(app.title || app.id) % palettes.length];
}

function glyphFor(title) {
  const value = String(title || "H").trim();
  const first = [...value][0] || "H";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function escapeAttr(value) { return escapeHTML(value); }

function iconHTML(app) {
  return app.icon
    ? `<img src="${escapeAttr(app.icon)}" alt="">`
    : `<span class="app-glyph">${escapeHTML(glyphFor(app.title))}</span>`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const output = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(output)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUnlocked() {
  return state.demo || sessionStorage.getItem(SESSION_KEY) === "1";
}

function requireUnlocked() {
  if (isUnlocked()) return;
  const error = new Error("unauthorized");
  error.status = 401;
  throw error;
}

async function api(path, options = {}) {
  if (state.demo) return demoApi(path, options);
  const url = new URL(path, location.href);
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};

  if (url.pathname.endsWith("/api/auth")) {
    const configured = Boolean(localStorage.getItem(PASSWORD_KEY));
    if (method === "GET") return { authenticated: isUnlocked(), configured };
    if (method === "DELETE") {
      sessionStorage.removeItem(SESSION_KEY);
      return { ok: true };
    }
    if (method === "POST") {
      const password = String(body.password || "");
      if (!password) throw new Error("empty_password");
      const candidate = await digest(password);
      const saved = localStorage.getItem(PASSWORD_KEY);
      if (saved && saved !== candidate) throw new Error("wrong_password");
      if (!saved) localStorage.setItem(PASSWORD_KEY, candidate);
      sessionStorage.setItem(SESSION_KEY, "1");
      return { ok: true, authenticated: true, configured: true };
    }
  }

  requireUnlocked();
  if (!url.pathname.endsWith("/api/apps")) throw new Error("unsupported_action");

  const id = url.searchParams.get("id");
  if (method === "GET" && id) {
    const record = await withStore("readonly", (store) => store.get(id));
    if (!record) throw new Error("not_found");
    return record;
  }
  if (method === "GET") {
    const records = await withStore("readonly", (store) => store.getAll());
    const apps = records
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(({ html, ...record }) => record);
    return { apps };
  }
  if (method === "POST") {
    const now = new Date().toISOString();
    const record = { ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await withStore("readwrite", (store) => store.add(record));
    return record;
  }
  if (method === "PUT" && id) {
    const current = await withStore("readonly", (store) => store.get(id));
    if (!current) throw new Error("not_found");
    const record = { ...current, ...body, id, updatedAt: new Date().toISOString() };
    await withStore("readwrite", (store) => store.put(record));
    return record;
  }
  if (method === "DELETE" && id) {
    await withStore("readwrite", (store) => store.delete(id));
    return { ok: true };
  }
  throw new Error("unsupported_action");
}

async function demoApi(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const url = new URL(path, location.href);
  if (url.pathname.endsWith("/api/auth")) return { authenticated: true, configured: true, ok: true };
  if (url.pathname.endsWith("/api/apps") && (!options.method || options.method === "GET")) {
    const id = url.searchParams.get("id");
    return id ? demoApps.find((app) => app.id === id) : { apps: demoApps.map(({ html, ...app }) => app) };
  }
  throw new Error("演示模式不会改动数据");
}

function renderApps() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const visible = state.apps.filter((app) => `${app.title} ${app.subtitle}`.toLowerCase().includes(query));
  $("#appCount").textContent = `${state.apps.length} ${state.apps.length === 1 ? "ITEM" : "ITEMS"}`;
  $("#emptyState").hidden = state.apps.length > 0 || query;
  $("#appGrid").innerHTML = visible.map((app, index) => {
    const [bg, fg] = paletteFor(app);
    return `<article class="app-card" data-id="${escapeAttr(app.id)}" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <button type="button" aria-label="打开 ${escapeAttr(app.title)}">
        <span class="app-icon" style="--icon-bg:${bg};--icon-fg:${fg}">${iconHTML(app)}</span>
        <strong>${escapeHTML(app.title)}</strong>
        <small>${escapeHTML(app.subtitle || formatDate(app.updatedAt))}</small>
      </button>
    </article>`;
  }).join("");

  $$(".app-card").forEach((card) => {
    let timer;
    let longPressed = false;
    const id = card.dataset.id;
    const start = () => {
      longPressed = false;
      timer = setTimeout(() => { longPressed = true; openActions(id); navigator.vibrate?.(25); }, 520);
    };
    const clear = () => clearTimeout(timer);
    card.addEventListener("pointerdown", start);
    card.addEventListener("pointerup", clear);
    card.addEventListener("pointercancel", clear);
    card.addEventListener("pointermove", clear);
    card.querySelector("button").addEventListener("click", (event) => {
      if (longPressed) { event.preventDefault(); return; }
      openViewer(id);
    });
    card.addEventListener("contextmenu", (event) => { event.preventDefault(); openActions(id); });
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
}

async function loadApps() {
  const data = await api("./api/apps");
  state.apps = data.apps || [];
  renderApps();
}

function showSheet(element) {
  $$(".sheet").forEach((sheet) => { sheet.hidden = true; });
  $("#scrim").hidden = false;
  element.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSheets() {
  $$(".sheet").forEach((sheet) => { sheet.hidden = true; });
  $("#scrim").hidden = true;
  document.body.style.overflow = "";
}

function openEditor(record = null) {
  state.editingId = record?.id || null;
  $("#editorTitle").textContent = record ? "编辑应用" : "放入新应用";
  $("#titleInput").value = record?.title || "";
  $("#subtitleInput").value = record?.subtitle || "";
  $("#htmlInput").value = record?.html || "";
  $("#htmlInput").dataset.icon = record?.icon || "";
  $("#htmlInput").dataset.themeColor = record?.themeColor || "";
  $("#editorError").textContent = "";
  updateCodeStats();
  showSheet($("#editorSheet"));
}

function extractMeta(html, fileName = "") {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const title = documentNode.querySelector("title")?.textContent?.trim() || fileName.replace(/\.html?$/i, "");
  const theme = documentNode.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "";
  const icon = documentNode.querySelector('link[rel~="icon"]')?.getAttribute("href") || "";
  return {
    title,
    themeColor: /^#[0-9a-f]{6}$/i.test(theme) ? theme : palettes[hash(title || fileName) % palettes.length][0],
    icon: /^(data:image\/|https?:\/\/)/i.test(icon) ? icon : ""
  };
}

async function readFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    $("#editorError").textContent = "这份 HTML 超过 2 MB 了。";
    return;
  }
  const html = await file.text();
  const meta = extractMeta(html, file.name);
  $("#htmlInput").value = html;
  if (!$("#titleInput").value.trim()) $("#titleInput").value = meta.title;
  $("#htmlInput").dataset.icon = meta.icon;
  $("#htmlInput").dataset.themeColor = meta.themeColor;
  updateCodeStats();
  toast(`已读取 ${file.name}`);
}

async function saveEditor() {
  const html = $("#htmlInput").value;
  const title = $("#titleInput").value.trim() || extractMeta(html).title || "未命名应用";
  if (!html.trim()) {
    $("#editorError").textContent = "还没有放入 HTML 内容。";
    return;
  }
  const meta = extractMeta(html, title);
  const payload = {
    title,
    subtitle: $("#subtitleInput").value.trim(),
    html,
    icon: $("#htmlInput").dataset.icon || meta.icon,
    themeColor: $("#htmlInput").dataset.themeColor || meta.themeColor
  };
  $("#saveButton").disabled = true;
  try {
    const path = state.editingId ? `./api/apps?id=${encodeURIComponent(state.editingId)}` : "./api/apps";
    const saved = await api(path, { method: state.editingId ? "PUT" : "POST", body: JSON.stringify(payload) });
    const index = state.apps.findIndex((app) => app.id === saved.id);
    const metaRecord = { ...saved };
    delete metaRecord.html;
    if (index >= 0) state.apps[index] = metaRecord;
    else state.apps.unshift(metaRecord);
    closeSheets();
    renderApps();
    toast(state.editingId ? "修改已保存" : "已经放进页匣");
  } catch (error) {
    $("#editorError").textContent = friendlyError(error);
  } finally {
    $("#saveButton").disabled = false;
  }
}

async function getFullApp(id) {
  const current = state.activeApp?.id === id ? state.activeApp : null;
  if (current?.html) return current;
  const record = await api(`./api/apps?id=${encodeURIComponent(id)}`);
  state.activeApp = record;
  return record;
}

async function openViewer(id) {
  try {
    const record = await getFullApp(id);
    state.activeApp = record;
    $("#viewerTitle").textContent = record.title;
    $("#appFrame").srcdoc = record.html;
    $("#viewer").hidden = false;
    document.body.style.overflow = "hidden";
  } catch (error) { toast(friendlyError(error)); }
}

function closeViewer() {
  $("#viewer").hidden = true;
  $("#appFrame").srcdoc = "";
  document.body.style.overflow = "";
}

function openActions(id) {
  const app = state.apps.find((item) => item.id === id) || state.activeApp;
  if (!app) return;
  state.activeApp = app;
  const [bg] = paletteFor(app);
  $("#actionTitle").textContent = app.title;
  $("#actionSubtitle").textContent = app.subtitle || "HTML 应用";
  $("#actionIcon").style.setProperty("--icon-bg", bg);
  $("#actionIcon").innerHTML = iconHTML(app);
  showSheet($("#actionsSheet"));
}

function downloadRecord(record) {
  const blob = new Blob([record.html], { type: "text/html;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeFileName(record.title)}.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function handleAction(action) {
  const app = state.activeApp;
  if (!app) return;
  closeSheets();
  if (action === "open") return openViewer(app.id);
  const full = await getFullApp(app.id);
  if (action === "edit") return openEditor(full);
  if (action === "download") return downloadRecord(full);
  if (action === "share") {
    try {
      const file = new File([full.html], `${safeFileName(full.title)}.html`, { type: "text/html" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: full.title, files: [file] });
      } else {
        downloadRecord(full);
        toast("设备不支持直接分享，已下载 HTML");
      }
    } catch (error) {
      if (error.name !== "AbortError") toast("刚才没有分享成功");
    }
    return;
  }
  if (action === "delete") {
    if (!confirm(`确定删除“${app.title}”吗？`)) return;
    try {
      await api(`./api/apps?id=${encodeURIComponent(app.id)}`, { method: "DELETE" });
      state.apps = state.apps.filter((item) => item.id !== app.id);
      state.activeApp = null;
      renderApps();
      toast("应用已删除");
    } catch (error) { toast(friendlyError(error)); }
  }
}

function safeFileName(value) {
  return String(value || "app").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
}

function updateCodeStats() {
  $("#codeStats").textContent = `${$("#htmlInput").value.length.toLocaleString("zh-CN")} 字符`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2200);
}

function friendlyError(error) {
  const map = {
    unauthorized: "页匣已经锁上，请重新进入。",
    wrong_password: "密码不对。",
    empty_password: "先写一个密码。",
    not_found: "这份应用已经不存在了。"
  };
  return map[error.message] || "刚才没有保存成功，再试一次。";
}

function applyTheme(theme) {
  localStorage.setItem("page-vault-theme", theme);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $$("[data-theme]").forEach((button) => button.classList.toggle("active", button.dataset.theme === theme));
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $('meta[name="theme-color"]').content = dark ? "#171715" : "#f0ede6";
}

function showLogin(configured, error = "") {
  $("#loginTitle").textContent = configured ? "打开页匣" : "设置页匣密码";
  $("#loginDescription").textContent = configured ? "输入只属于你的访问密码。" : "首次打开，设置一个保存在这台设备上的密码。";
  $("#loginSubmit").textContent = configured ? "进入" : "设置并进入";
  $("#passwordInput").autocomplete = configured ? "current-password" : "new-password";
  $("#loginError").textContent = error;
  $("#loginScreen").hidden = false;
}

async function init() {
  $("#dateLabel").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  applyTheme(localStorage.getItem("page-vault-theme") || "system");
  try {
    const session = await api("./api/auth");
    if (!session.authenticated) showLogin(session.configured);
    else await loadApps();
  } catch {
    showLogin(Boolean(localStorage.getItem(PASSWORD_KEY)), "暂时无法读取设备存储。");
  } finally {
    $("#app").classList.remove("is-loading");
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    await api("./api/auth", { method: "POST", body: JSON.stringify({ password: $("#passwordInput").value }) });
    $("#loginScreen").hidden = true;
    $("#passwordInput").value = "";
    await loadApps();
  } catch (error) { $("#loginError").textContent = friendlyError(error); }
});

$("#showPassword").addEventListener("click", () => {
  const input = $("#passwordInput");
  input.type = input.type === "password" ? "text" : "password";
});

[$("#addHeroButton"), $("#floatingAdd"), $("#emptyState")].forEach((button) => button.addEventListener("click", () => openEditor()));
$("#settingsButton").addEventListener("click", () => showSheet($("#settingsSheet")));
$("#scrim").addEventListener("click", closeSheets);
$$("[data-close-sheet]").forEach((button) => button.addEventListener("click", closeSheets));
$("#uploadZone").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", (event) => readFile(event.target.files[0]));
$("#htmlInput").addEventListener("input", updateCodeStats);
$("#saveButton").addEventListener("click", saveEditor);
$("#searchInput").addEventListener("input", renderApps);
$$("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
$("#closeViewer").addEventListener("click", closeViewer);
$("#viewerMore").addEventListener("click", () => { closeViewer(); openActions(state.activeApp?.id); });
$$("[data-theme]").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme)));
$("#logoutButton").addEventListener("click", async () => {
  await api("./api/auth", { method: "DELETE" });
  closeSheets();
  showLogin(true);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstall = event;
});

$("#installButton").addEventListener("click", async () => {
  if (state.deferredInstall) {
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    closeSheets();
  } else {
    showSheet($("#installSheet"));
  }
});

if ("serviceWorker" in navigator && !state.demo) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

init();
