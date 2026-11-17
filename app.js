const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DB_NAME = "page-vault";
const STORE_NAME = "apps";
const THEME_STORE_NAME = "themes";
const APP_STATE_STORE_NAME = "appStates";
const SNAPSHOT_STORE_NAME = "appSnapshots";
const PASSWORD_KEY = "page-vault-password";
const SESSION_KEY = "page-vault-unlocked";
const THEME_KEY = "page-vault-theme";
const LOCK_TIMEOUT_KEY = "page-vault-lock-timeout";
const LAST_ACTIVITY_KEY = "page-vault-last-activity";
const ACTIVE_THEME_KEY = "page-vault-active-custom-theme";
const VIEWER_PREFS_KEY = "page-vault-viewer-preferences-v1";
const LAST_APP_KEY = "lijian-last-app";
const GRID_DENSITY_KEY = "lijian-grid-density";
const PREVIOUS_THEME_KEY = "lijian-previous-theme";

const state = {
  records: [], apps: [], trash: [], activeApp: null, editingId: null,
  deferredInstall: null, filter: { type: "all", value: "" },
  multiSelect: false, selected: new Set(), lockTimer: null,
  themes: [], activeTheme: null, appliedThemeVariables: [],
  runtimeSaveChain: Promise.resolve(), activeRuntimeSession: null,
  viewerPreferences: {}, effectiveViewerZoom: 1,
  editingOriginal: null, dataTargetId: null, reorderDraft: [], previewThemeId: null,
  compatibilityDraft: null,
  demo: new URLSearchParams(location.search).has("demo")
};

const palettes = [
  ["#3c4038", "#f5efdf"], ["#243a3c", "#edf0e8"], ["#5a3932", "#f7e8d9"],
  ["#323039", "#f1edf5"], ["#5d553b", "#fff6d8"], ["#293742", "#e9f0f2"],
  ["#6a4a53", "#faeaf0"], ["#354137", "#eaf2e9"], ["#4a423b", "#f2ece5"]
];

const darkPalettes = [
  ["#596052", "#fffaf0"], ["#36575a", "#f4fbf6"], ["#755047", "#fff3e8"],
  ["#514d5a", "#faf5ff"], ["#766c4d", "#fff8dc"], ["#405867", "#f1f8fa"],
  ["#815d68", "#fff1f6"], ["#4d6252", "#f1faef"], ["#665b50", "#fff7ee"]
];

const demoApps = [
  { id: "demo-1", title: "夜间手记", subtitle: "私人记录", folder: "日常", tags: ["常用"], favorite: true, themeColor: "#323039", icon: "", iconBackground: "palette", updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), html: "<!doctype html><meta name='viewport' content='width=device-width'><style>body{margin:0;background:#17171b;color:#eee;font:16px system-ui;padding:40px}h1{font:42px Georgia;font-weight:400}p{color:#aaa;line-height:1.8}</style><h1>夜间手记</h1><p>这是一份存进里间的 HTML。</p>" },
  { id: "demo-2", title: "颜色标本", subtitle: "配色收藏", folder: "设计", tags: ["配色"], favorite: false, themeColor: "#5a3932", icon: "", iconBackground: "transparent", updatedAt: new Date(Date.now() - 3600000).toISOString(), createdAt: new Date().toISOString(), html: "<!doctype html><meta name='viewport' content='width=device-width'><style>body{font-family:system-ui;padding:30px;background:#f1eee6}.c{height:90px;border-radius:20px;margin:15px;background:#5a3932}.c:nth-child(2){background:#243a3c}.c:nth-child(3){background:#d8c9ae}</style><div class=c></div><div class=c></div><div class=c></div>" },
  { id: "demo-3", title: "小小计时器", subtitle: "专注工具", folder: "工具", tags: ["计时"], favorite: false, themeColor: "#243a3c", icon: "", iconBackground: "palette", updatedAt: new Date(Date.now() - 7200000).toISOString(), createdAt: new Date().toISOString(), html: "<!doctype html><meta name='viewport' content='width=device-width'><style>body{display:grid;place-items:center;height:100vh;margin:0;background:#e9efeb;font-family:system-ui}.t{font:70px Georgia}</style><div class=t>25:00</div>" }
];

function hash(input) {
  let value = 0;
  for (const char of input) value = ((value << 5) - value + char.charCodeAt(0)) | 0;
  return Math.abs(value);
}

function paletteFor(app, index = 0) {
  const cardTheme = state.activeTheme?.cards;
  if (cardTheme?.colorMode === "uniform" && cardTheme.palette.length) return cardTheme.palette[0];
  if (cardTheme?.colorMode === "cycle" && cardTheme.palette.length) return cardTheme.palette[index % cardTheme.palette.length];
  const dark = isDarkAppearance();
  if (/^#[0-9a-f]{6}$/i.test(app.themeColor || "")) return [dark ? blendHex(app.themeColor, "#ffffff", .18) : app.themeColor, "#fffaf0"];
  const source = dark ? darkPalettes : palettes;
  return source[hash(app.title || app.id) % source.length];
}

function isDarkAppearance() {
  const theme = localStorage.getItem(THEME_KEY) || "system";
  return theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

function blendHex(from, to, amount) {
  const parse = (value) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const [fr, fg, fb] = parse(from); const [tr, tg, tb] = parse(to);
  return `#${[fr + (tr - fr) * amount, fg + (tg - fg) * amount, fb + (tb - fb) * amount].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function glyphFor(title) {
  const first = [...String(title || "H").trim()][0] || "H";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function iconHTML(app) {
  return app.icon ? `<img src="${escapeHTML(app.icon)}" alt="">` : `<span class="app-glyph">${escapeHTML(glyphFor(app.title))}</span>`;
}

function normalizeTags(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[,，]/);
  return [...new Set(input.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20);
}

function normalizeRecord(record) {
  const now = new Date().toISOString();
  return {
    id: record.id || crypto.randomUUID(),
    title: String(record.title || "未命名应用").slice(0, 80),
    subtitle: String(record.subtitle || "").slice(0, 120),
    html: String(record.html || ""), icon: String(record.icon || ""),
    iconBackground: record.iconBackground === "palette" ? "palette" : "transparent",
    themeColor: String(record.themeColor || ""),
    folder: String(record.folder || "").trim().slice(0, 40),
    tags: normalizeTags(record.tags), favorite: Boolean(record.favorite),
    order: Number.isFinite(Number(record.order)) ? Number(record.order) : Number.MAX_SAFE_INTEGER,
    versions: Array.isArray(record.versions) ? record.versions.slice(0, 5).map((item) => ({
      id: String(item.id || crypto.randomUUID()),
      savedAt: item.savedAt || now,
      title: String(item.title || record.title || "未命名应用").slice(0, 80),
      html: String(item.html || "")
    })).filter((item) => item.html) : [],
    lastOpenedAt: record.lastOpenedAt || null, deletedAt: record.deletedAt || null,
    createdAt: record.createdAt || now, updatedAt: record.updatedAt || now
  };
}

function themeSlug(value) {
  return String(value || "custom-theme").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "custom-theme";
}

function validateThemeCSS(css) {
  const source = String(css || "");
  if (source.length > 500000) throw new Error("theme_css_too_large");
  const unsafe = /@import\b|javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding|url\s*\(\s*(['"])?\s*(?:https?:|\/\/|file:|blob:)/i;
  if (unsafe.test(source)) throw new Error("theme_external_resource");
  return source;
}

function validateThemeAsset(value) {
  const data = String(value || "");
  const allowed = /^data:(?:image\/(?:png|jpeg|webp|gif|avif)|font\/(?:woff|woff2|ttf|otf)|application\/(?:font-woff|font-woff2));base64,/i;
  if (allowed.test(data)) return data;
  if (/^data:image\/svg\+xml;base64,/i.test(data)) {
    try {
      const svg = atob(data.slice(data.indexOf(",") + 1));
      if (!/(?:https?:|<script|foreignObject|xlink:href|\shref\s*=)/i.test(svg)) return data;
    } catch { /* invalid base64 */ }
  }
  return "";
}

function normalizeThemeColor(value, fallback) {
  const color = String(value || "").trim();
  if (!color || color.length > 120) return fallback;
  validateThemeCSS(`x{color:${color}}`);
  return color;
}

function normalizeThemeCards(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const colorMode = ["original", "uniform", "cycle"].includes(input.colorMode) ? input.colorMode : "original";
  const rawPalette = Array.isArray(input.palette) ? input.palette : [];
  const palette = rawPalette.slice(0, 24).map((pair) => {
    const source = Array.isArray(pair) ? pair : [pair?.background, pair?.foreground];
    return [normalizeThemeColor(source[0], "#34322f"), normalizeThemeColor(source[1], "#fffaf0")];
  });
  if (!palette.length && colorMode !== "original") palette.push(["#34322f", "#fffaf0"]);
  const variants = (Array.isArray(input.variants) ? input.variants : []).slice(0, 24).map((variant) => {
    const safe = {};
    if (!variant || typeof variant !== "object") return safe;
    for (const [key, value] of Object.entries(variant)) {
      if (!/^--(?:card|icon|title|subtitle|badge)-[a-z0-9_-]+$/i.test(key) || String(value).length > 500) continue;
      validateThemeCSS(`x{${key}:${String(value)}}`);
      safe[key] = String(value);
    }
    return safe;
  }).filter((variant) => Object.keys(variant).length);
  return { colorMode, palette, variants };
}

function normalizeTheme(raw, fallbackName = "自定义主题") {
  const input = raw && typeof raw === "object" ? raw : {};
  const name = String(input.name || fallbackName).trim().slice(0, 60) || "自定义主题";
  const variables = {};
  for (const [key, value] of Object.entries(input.variables || {})) {
    if (/^--[a-z0-9_-]+$/i.test(key) && String(value).length <= 500) {
      validateThemeCSS(`x{value:${String(value)}}`);
      variables[key] = String(value);
    }
  }
  const assets = {};
  let assetSize = 0;
  for (const [key, value] of Object.entries(input.assets || {})) {
    const data = validateThemeAsset(value);
    if (!/^[a-z0-9_-]{1,60}$/i.test(key) || !data) continue;
    assetSize += data.length;
    if (assetSize > 4 * 1024 * 1024) throw new Error("theme_assets_too_large");
    assets[key] = data;
  }
  let css = String(input.css || "");
  for (const [key, data] of Object.entries(assets)) css = css.split(`asset://${key}`).join(data);
  css = validateThemeCSS(css);
  return {
    id: themeSlug(input.id || name), format: "page-vault-theme", schemaVersion: 2,
    name, author: String(input.author || "").slice(0, 60),
    description: String(input.description || "").slice(0, 180),
    variables, assets, css, cards: normalizeThemeCards(input.cards),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function clearAppliedTheme() {
  for (const key of state.appliedThemeVariables) document.documentElement.style.removeProperty(key);
  state.appliedThemeVariables = [];
  $("#customThemeStyle").textContent = "";
  delete document.documentElement.dataset.customTheme;
  delete document.documentElement.dataset.cardColorMode;
}

function setActiveThemeLabel() {
  $("#activeThemeLabel").textContent = state.activeTheme?.name || "默认外观";
}

function refreshThemeCards() {
  if ($("#appGrid") && state.apps.length) renderApps();
}

function applyCustomTheme(theme, persist = true) {
  clearAppliedTheme();
  const safeMode = new URLSearchParams(location.search).has("safe");
  if (!theme) {
    state.activeTheme = null;
    if (persist) localStorage.removeItem(ACTIVE_THEME_KEY);
    setActiveThemeLabel();
    refreshThemeCards();
    return;
  }
  if (safeMode) {
    state.activeTheme = null;
    setActiveThemeLabel();
    refreshThemeCards();
    return;
  }
  const normalized = normalizeTheme(theme, theme.name);
  for (const [key, value] of Object.entries(normalized.variables)) {
    document.documentElement.style.setProperty(key, value);
    state.appliedThemeVariables.push(key);
  }
  const contrastGuard = `
:root[data-custom-theme] .sheet,
:root[data-custom-theme] .viewer-menu-card,
:root[data-custom-theme] .switcher-card,
:root[data-custom-theme] .viewer-controls-card { color: var(--ink) !important; }
:root[data-custom-theme] .sheet button,
:root[data-custom-theme] .sheet input,
:root[data-custom-theme] .sheet textarea,
:root[data-custom-theme] .sheet select,
:root[data-custom-theme] .viewer-menu-card button,
:root[data-custom-theme] .switcher-card button,
:root[data-custom-theme] .viewer-controls-card button { color: inherit !important; }
:root[data-custom-theme] input::placeholder,
:root[data-custom-theme] textarea::placeholder { color: var(--muted) !important; opacity: 1; }`;
  $("#customThemeStyle").textContent = `${normalized.css}\n${contrastGuard}`;
  document.documentElement.dataset.customTheme = normalized.id;
  document.documentElement.dataset.cardColorMode = normalized.cards.colorMode;
  state.activeTheme = normalized;
  if (persist) localStorage.setItem(ACTIVE_THEME_KEY, normalized.id);
  setActiveThemeLabel();
  refreshThemeCards();
}

async function loadThemes() {
  state.themes = (await withStore("readonly", (store) => store.getAll(), THEME_STORE_NAME)).map((theme) => normalizeTheme(theme, theme.name));
  const activeId = localStorage.getItem(ACTIVE_THEME_KEY);
  const active = state.themes.find((theme) => theme.id === activeId) || null;
  try { applyCustomTheme(active, false); }
  catch { applyCustomTheme(null, false); }
}

async function saveTheme(theme) {
  let record = normalizeTheme(theme, theme.name);
  const existing = state.themes.find((item) => item.id === record.id);
  if (existing && existing.updatedAt !== theme.updatedAt) record.id = `${record.id}-${Date.now().toString(36)}`;
  await withStore("readwrite", (store) => store.put(record), THEME_STORE_NAME);
  const index = state.themes.findIndex((item) => item.id === record.id);
  if (index >= 0) state.themes[index] = record; else state.themes.push(record);
  return record;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(THEME_STORE_NAME)) request.result.createObjectStore(THEME_STORE_NAME, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(APP_STATE_STORE_NAME)) request.result.createObjectStore(APP_STATE_STORE_NAME, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
        const snapshots = request.result.createObjectStore(SNAPSHOT_STORE_NAME, { keyPath: "id" });
        snapshots.createIndex("appId", "appId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation, storeName = STORE_NAME) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    if (request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
    transaction.oncomplete = () => { database.close(); if (!request) resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

async function putMany(records) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    records.forEach((record) => store.put(normalizeRecord(record)));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

function cloneJSON(value, fallback) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return fallback; }
}

function normalizeRuntimeState(id, input = {}) {
  const record = {
    id,
    form: input.form && typeof input.form === "object" ? cloneJSON(input.form, {}) : {},
    storage: input.storage && typeof input.storage === "object" ? cloneJSON(input.storage, {}) : {},
    custom: cloneJSON(input.custom, null),
    scroll: {
      x: Number.isFinite(Number(input.scroll?.x)) ? Number(input.scroll.x) : 0,
      y: Number.isFinite(Number(input.scroll?.y)) ? Number(input.scroll.y) : 0
    },
    updatedAt: new Date().toISOString()
  };
  if (JSON.stringify(record).length > 5 * 1024 * 1024) throw new Error("runtime_state_too_large");
  return record;
}

async function getRuntimeState(id) {
  if (state.demo) return normalizeRuntimeState(id);
  const saved = await withStore("readonly", (store) => store.get(id), APP_STATE_STORE_NAME);
  return normalizeRuntimeState(id, saved || {});
}

async function putRuntimeStates(records) {
  if (!Array.isArray(records) || !records.length) return;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(APP_STATE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(APP_STATE_STORE_NAME);
    records.forEach((record) => {
      if (record?.id) store.put(normalizeRuntimeState(String(record.id), record));
    });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function deleteRuntimeState(id) {
  if (state.demo) return;
  await withStore("readwrite", (store) => store.delete(id), APP_STATE_STORE_NAME);
}

async function getRuntimeSnapshots(appId) {
  if (state.demo) return [];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readonly");
    const index = transaction.objectStore(SNAPSHOT_STORE_NAME).index("appId");
    const request = index.getAll(appId);
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function putRuntimeSnapshots(records) {
  if (!Array.isArray(records) || !records.length || state.demo) return;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
    records.forEach((record) => {
      if (!record?.appId || !record?.runtime) return;
      store.put({ id: String(record.id || crypto.randomUUID()), appId: String(record.appId), createdAt: record.createdAt || new Date().toISOString(), reason: String(record.reason || "备份"), runtime: normalizeRuntimeState(String(record.appId), record.runtime) });
    });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function createRuntimeSnapshot(appId, reason = "手动保存", quiet = false) {
  if (!appId || state.demo) return null;
  const runtime = await getRuntimeState(appId);
  const snapshot = { id: crypto.randomUUID(), appId, createdAt: new Date().toISOString(), reason, runtime };
  await withStore("readwrite", (store) => store.put(snapshot), SNAPSHOT_STORE_NAME);
  const all = await getRuntimeSnapshots(appId);
  for (const old of all.slice(8)) await withStore("readwrite", (store) => store.delete(old.id), SNAPSHOT_STORE_NAME);
  if (!quiet) toast("数据快照已保存");
  return snapshot;
}

async function deleteRuntimeSnapshots(appId) {
  if (state.demo) return;
  const snapshots = await getRuntimeSnapshots(appId);
  for (const snapshot of snapshots) await withStore("readwrite", (store) => store.delete(snapshot.id), SNAPSHOT_STORE_NAME);
}

function queueRuntimeStateSave(id, payload) {
  if (state.demo || !id) return;
  const snapshot = normalizeRuntimeState(id, payload);
  state.runtimeSaveChain = state.runtimeSaveChain
    .catch(() => {})
    .then(() => withStore("readwrite", (store) => store.put(snapshot), APP_STATE_STORE_NAME))
    .catch((error) => console.warn("Page Vault state save failed", error));
}

function pageVaultRuntimeBridge(initialState, appId, runtimeSession) {
  "use strict";
  const CHANNEL = "page-vault-runtime-v1";
  const initial = initialState && typeof initialState === "object" ? initialState : {};
  let formState = initial.form && typeof initial.form === "object" ? initial.form : {};
  let customState = initial.custom ?? null;
  let scrollState = initial.scroll && typeof initial.scroll === "object" ? initial.scroll : { x: 0, y: 0 };
  let displaySettings = { zoom: 1, fitWidth: false, scrollLocked: false };
  let saveTimer = 0;
  let restoring = false;
  const storageData = {};
  const restoredFields = new WeakSet();

  Object.entries(initial.storage || {}).forEach(([key, value]) => { storageData[String(key)] = String(value); });

  function clone(value, fallback = null) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return fallback; }
  }

  function post(type, payload) {
    parent.postMessage({ channel: CHANNEL, type, appId, runtimeSession, payload }, "*");
  }

  function clampZoom(value) {
    const number = Number(value);
    return Math.min(2, Math.max(.5, Number.isFinite(number) ? number : 1));
  }

  function displayLockStyle() {
    let style = document.getElementById("page-vault-display-lock");
    if (!style) {
      style = document.createElement("style");
      style.id = "page-vault-display-lock";
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function naturalDocumentWidth() {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(
      window.innerWidth || 0,
      root?.scrollWidth || 0, root?.offsetWidth || 0,
      body?.scrollWidth || 0, body?.offsetWidth || 0
    );
  }

  function applyDisplaySettings() {
    const root = document.documentElement;
    if (!root) return;
    root.style.zoom = "1";
    const naturalWidth = naturalDocumentWidth();
    const requestedZoom = clampZoom(displaySettings.zoom);
    const fitZoom = naturalWidth > 0 ? Math.min(1, (window.innerWidth || naturalWidth) / naturalWidth) : 1;
    const effectiveZoom = displaySettings.fitWidth ? Math.min(1, Math.max(.1, fitZoom)) : requestedZoom;
    root.style.zoom = String(effectiveZoom);
    displayLockStyle().textContent = displaySettings.scrollLocked
      ? "html,body{overflow:hidden!important;overscroll-behavior:none!important;}"
      : "";
    post("display-state", {
      effectiveZoom,
      naturalWidth,
      fitWidth: Boolean(displaySettings.fitWidth),
      scrollLocked: Boolean(displaySettings.scrollLocked)
    });
  }

  function blockLockedScroll(event) {
    if (!displaySettings.scrollLocked) return;
    if (event.type === "keydown") {
      const editable = event.target?.matches?.("input,textarea,select,[contenteditable]");
      if (editable || !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
    }
    event.preventDefault();
  }

  document.addEventListener("touchmove", blockLockedScroll, { passive: false, capture: true });
  document.addEventListener("wheel", blockLockedScroll, { passive: false, capture: true });
  document.addEventListener("keydown", blockLockedScroll, { capture: true });

  const storage = {
    key(index) { return Object.keys(storageData)[Number(index)] ?? null; },
    getItem(key) { key = String(key); return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null; },
    setItem(key, value) { storageData[String(key)] = String(value); scheduleSave(); },
    removeItem(key) { delete storageData[String(key)]; scheduleSave(); },
    clear() { Object.keys(storageData).forEach((key) => delete storageData[key]); scheduleSave(); }
  };
  Object.defineProperty(storage, "length", { enumerable: true, get: () => Object.keys(storageData).length });
  try { Object.defineProperty(window, "localStorage", { configurable: true, enumerable: true, value: storage }); }
  catch { /* opaque sandbox storage stays unavailable; PageVault.storage still works */ }

  function editableFields() {
    return [...document.querySelectorAll("input, textarea, select, [contenteditable]")]
      .filter((element) => element.type !== "file" && element.type !== "password");
  }

  function fieldKey(element) {
    if (element.dataset?.pvKey) return `key:${element.dataset.pvKey}`;
    if (element.id) return `id:${element.id}`;
    const type = String(element.type || element.tagName).toLowerCase();
    if (element.name) {
      const peers = editableFields().filter((item) => item.name === element.name && String(item.type || item.tagName).toLowerCase() === type);
      const valuePart = ["checkbox", "radio"].includes(type) ? `:${element.value}` : "";
      return `name:${element.name}:${type}${valuePart}:${Math.max(0, peers.indexOf(element))}`;
    }
    const fields = editableFields();
    return `index:${fields.indexOf(element)}:${type}`;
  }

  function readField(element) {
    const type = String(element.type || "").toLowerCase();
    if (element.isContentEditable) return { kind: "html", value: element.innerHTML };
    if (type === "checkbox" || type === "radio") return { kind: "check", checked: element.checked, value: element.value };
    if (element.tagName === "SELECT" && element.multiple) {
      return { kind: "multi", values: [...element.selectedOptions].map((option) => option.value) };
    }
    return { kind: "value", value: element.value };
  }

  function restoreField(element, saved) {
    if (!saved || typeof saved !== "object") return;
    if (saved.kind === "html" && element.isContentEditable) element.innerHTML = String(saved.value ?? "");
    else if (saved.kind === "check" && "checked" in element) element.checked = Boolean(saved.checked);
    else if (saved.kind === "multi" && element.tagName === "SELECT") {
      const selected = new Set(Array.isArray(saved.values) ? saved.values.map(String) : []);
      [...element.options].forEach((option) => { option.selected = selected.has(option.value); });
    } else if ("value" in element && saved.kind === "value") element.value = String(saved.value ?? "");
  }

  function collectForm() {
    const next = {};
    editableFields().forEach((element) => { next[fieldKey(element)] = readField(element); });
    formState = next;
  }

  function restoreForm(onlyNew = false) {
    restoring = true;
    editableFields().forEach((element) => {
      if (!onlyNew || !restoredFields.has(element)) restoreField(element, formState[fieldKey(element)]);
      restoredFields.add(element);
    });
    restoring = false;
  }

  function snapshot() {
    collectForm();
    scrollState = { x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0) };
    return { form: formState, storage: { ...storageData }, custom: clone(customState), scroll: scrollState };
  }

  function flush() {
    clearTimeout(saveTimer);
    post("save", snapshot());
  }

  function scheduleSave(immediate = false) {
    if (restoring) return;
    clearTimeout(saveTimer);
    if (immediate) flush(); else saveTimer = setTimeout(flush, 180);
  }

  window.PageVault = {
    version: 1,
    storage,
    saveState(value) { customState = clone(value); scheduleSave(true); return clone(customState); },
    loadState() { return clone(customState); },
    clearState() {
      formState = {}; customState = null; scrollState = { x: 0, y: 0 };
      storage.clear(); scheduleSave(true); return true;
    }
  };

  document.addEventListener("input", () => scheduleSave(), true);
  document.addEventListener("change", () => scheduleSave(), true);
  document.addEventListener("scroll", () => scheduleSave(), true);
  window.addEventListener("pagehide", flush);
  window.addEventListener("message", (event) => {
    if (event.data?.channel !== CHANNEL) return;
    if (event.data.type === "flush") flush();
    if (event.data.type === "display") {
      const payload = event.data.payload && typeof event.data.payload === "object" ? event.data.payload : {};
      displaySettings = {
        zoom: clampZoom(payload.zoom),
        fitWidth: Boolean(payload.fitWidth),
        scrollLocked: Boolean(payload.scrollLocked)
      };
      applyDisplaySettings();
      requestAnimationFrame(applyDisplaySettings);
    }
  });
  window.addEventListener("resize", () => { if (displaySettings.fitWidth) applyDisplaySettings(); });

  function restoreAll() {
    restoreForm();
    const restoreScroll = () => window.scrollTo(Number(scrollState.x) || 0, Number(scrollState.y) || 0);
    requestAnimationFrame(restoreScroll);
    setTimeout(restoreScroll, 80);
    setTimeout(restoreScroll, 260);
    window.dispatchEvent(new CustomEvent("pagevaultrestore", { detail: clone(customState) }));
    post("ready", { restored: true });
    applyDisplaySettings();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restoreAll, { once: true });
  else restoreAll();
  new MutationObserver(() => restoreForm(true)).observe(document.documentElement, { childList: true, subtree: true });
}

function buildRuntimeDocument(html, appId, runtimeState, runtimeSession) {
  const source = `;(${pageVaultRuntimeBridge.toString()})(${JSON.stringify(runtimeState).replace(/</g, "\\u003c")},${JSON.stringify(appId)},${JSON.stringify(runtimeSession)});`;
  const script = `<script>${source.replace(/<\/script/gi, "<\\/script")}<\/script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${script}`);
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${script}</head>`);
  if (/<!doctype[^>]*>/i.test(html)) return html.replace(/<!doctype[^>]*>/i, (match) => `${match}${script}`);
  return `${script}${html}`;
}

function normalizeViewerPreferences(value) {
  const input = value && typeof value === "object" ? value : {};
  const zoom = Math.round(Math.min(200, Math.max(50, Number(input.zoom) || 100)) / 5) * 5;
  return {
    zoom,
    fitWidth: Boolean(input.fitWidth),
    landscape: Boolean(input.landscape),
    scrollLocked: Boolean(input.scrollLocked)
  };
}

function loadViewerPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEWER_PREFS_KEY) || "{}");
    state.viewerPreferences = stored && typeof stored === "object" ? stored : {};
  } catch { state.viewerPreferences = {}; }
}

function viewerPreferencesFor(id = state.activeApp?.id) {
  return normalizeViewerPreferences(id ? state.viewerPreferences[id] : null);
}

function saveViewerPreferences(id, preferences) {
  if (!id) return;
  state.viewerPreferences[id] = normalizeViewerPreferences(preferences);
  try { localStorage.setItem(VIEWER_PREFS_KEY, JSON.stringify(state.viewerPreferences)); }
  catch { toast("显示设置暂时无法保存"); }
}

function postViewerDisplay() {
  const frame = $("#appFrame");
  const preferences = viewerPreferencesFor();
  frame.contentWindow?.postMessage({
    channel: "page-vault-runtime-v1",
    type: "display",
    payload: {
      zoom: preferences.zoom / 100,
      fitWidth: preferences.fitWidth,
      scrollLocked: preferences.scrollLocked
    }
  }, "*");
}

function updateLandscapePreview() {
  const stage = $("#viewerStage");
  const shell = $("#viewerFrameShell");
  const landscape = viewerPreferencesFor().landscape;
  stage.classList.toggle("landscape", landscape);
  if (!landscape) {
    stage.style.removeProperty("--landscape-scale");
    shell.style.removeProperty("width");
    shell.style.removeProperty("height");
    return;
  }
  const width = 844;
  const height = 390;
  const scale = Math.min(1, Math.max(.2, (stage.clientWidth - 28) / width, 0), Math.max(.2, (stage.clientHeight - 28) / height, 0));
  stage.style.setProperty("--landscape-scale", String(scale));
  shell.style.width = `${Math.round(width * scale)}px`;
  shell.style.height = `${Math.round(height * scale)}px`;
}

function renderViewerControls() {
  const preferences = viewerPreferencesFor();
  const effective = preferences.fitWidth ? Math.round(state.effectiveViewerZoom * 100) : preferences.zoom;
  $("#viewerDisplayButton").textContent = preferences.fitWidth ? "适宽" : `${preferences.zoom}%`;
  $("#viewerDisplayButton").setAttribute("aria-label", `页面显示设置，当前${preferences.fitWidth ? `自动适宽 ${effective}%` : `${preferences.zoom}%`}`);
  $("#zoomValue").textContent = `${effective}%`;
  $("#zoomResetButton small").textContent = preferences.fitWidth ? "自动适宽" : "点按复原";
  $("#zoomRange").value = String(preferences.zoom);
  $("#fitWidthButton").setAttribute("aria-pressed", String(preferences.fitWidth));
  $("#landscapeButton").setAttribute("aria-pressed", String(preferences.landscape));
  $("#scrollLockButton").setAttribute("aria-pressed", String(preferences.scrollLocked));
  $$("#zoomPresets [data-zoom]").forEach((button) => {
    button.classList.toggle("active", !preferences.fitWidth && Number(button.dataset.zoom) === preferences.zoom);
  });
  $("#viewerMode").textContent = preferences.scrollLocked ? "页面滑动已锁定 · 本机自动保存" : "可滑动 · 本机自动保存";
}

function applyViewerPreferences({ persist = false } = {}) {
  const id = state.activeApp?.id;
  if (!id) return;
  const preferences = viewerPreferencesFor(id);
  if (persist) saveViewerPreferences(id, preferences);
  renderViewerControls();
  updateLandscapePreview();
  postViewerDisplay();
}

function updateViewerPreference(changes) {
  const id = state.activeApp?.id;
  if (!id) return;
  const preferences = { ...viewerPreferencesFor(id), ...changes };
  saveViewerPreferences(id, preferences);
  applyViewerPreferences();
}

function setViewerZoom(value) {
  const zoom = Math.round(Math.min(200, Math.max(50, Number(value) || 100)) / 5) * 5;
  state.effectiveViewerZoom = zoom / 100;
  updateViewerPreference({ zoom, fitWidth: false });
}

function openViewerControls() {
  renderViewerControls();
  $("#viewerControls").hidden = false;
  $("#viewerDisplayButton").setAttribute("aria-expanded", "true");
}

function closeViewerControls() {
  $("#viewerControls").hidden = true;
  $("#viewerDisplayButton").setAttribute("aria-expanded", "false");
}

function setImmersive(enabled) {
  closeViewerControls();
  $("#viewer").classList.toggle("immersive", Boolean(enabled));
  $("#immersiveExit").hidden = !enabled;
  requestAnimationFrame(updateLandscapePreview);
}

window.addEventListener("message", (event) => {
  const frame = $("#appFrame");
  if (!frame || event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.channel !== "page-vault-runtime-v1") return;
  if (!state.activeApp?.id || message.appId !== state.activeApp.id) return;
  if (!state.activeRuntimeSession || message.runtimeSession !== state.activeRuntimeSession) return;
  if (message.type === "save") {
    try { queueRuntimeStateSave(message.appId, message.payload); }
    catch (error) { console.warn("Page Vault rejected app state", error); }
  }
  if (message.type === "ready") postViewerDisplay();
  if (message.type === "display-state") {
    state.effectiveViewerZoom = Number(message.payload?.effectiveZoom) || 1;
    renderViewerControls();
  }
});

async function digest(value) {
  const output = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(output)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUnlocked() { return state.demo || sessionStorage.getItem(SESSION_KEY) === "1"; }
function requireUnlocked() { if (!isUnlocked()) throw new Error("unauthorized"); }

async function api(path, options = {}) {
  if (state.demo) return demoApi(path, options);
  const url = new URL(path, location.href);
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : {};

  if (url.pathname.endsWith("/api/auth")) {
    const configured = Boolean(localStorage.getItem(PASSWORD_KEY));
    if (method === "GET") return { authenticated: isUnlocked(), configured };
    if (method === "DELETE") {
      sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(LAST_ACTIVITY_KEY);
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
      sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
      return { ok: true, authenticated: true, configured: true };
    }
  }

  requireUnlocked();
  if (!url.pathname.endsWith("/api/apps")) throw new Error("unsupported_action");
  const id = url.searchParams.get("id");
  if (method === "GET" && id) {
    const record = await withStore("readonly", (store) => store.get(id));
    if (!record) throw new Error("not_found");
    return normalizeRecord(record);
  }
  if (method === "GET") {
    const records = await withStore("readonly", (store) => store.getAll());
    return { apps: records.map(normalizeRecord).map(({ html, ...record }) => record) };
  }
  if (method === "POST") {
    const now = new Date().toISOString();
    const record = normalizeRecord({ ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now });
    await withStore("readwrite", (store) => store.add(record));
    return record;
  }
  if (method === "PUT" && id) {
    const current = await withStore("readonly", (store) => store.get(id));
    if (!current) throw new Error("not_found");
    const { _touchOnly, ...updates } = body;
    const record = normalizeRecord({ ...current, ...updates, id, updatedAt: _touchOnly ? current.updatedAt : new Date().toISOString() });
    await withStore("readwrite", (store) => store.put(record));
    return record;
  }
  if (method === "DELETE" && id) {
    if (url.searchParams.get("permanent") === "1") {
      await withStore("readwrite", (store) => store.delete(id));
      await deleteRuntimeState(id);
      await deleteRuntimeSnapshots(id);
      return { ok: true, permanent: true };
    }
    const current = await withStore("readonly", (store) => store.get(id));
    if (!current) throw new Error("not_found");
    const record = normalizeRecord({ ...current, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await withStore("readwrite", (store) => store.put(record));
    return record;
  }
  throw new Error("unsupported_action");
}

async function demoApi(path, options = {}) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const url = new URL(path, location.href);
  if (url.pathname.endsWith("/api/auth")) return { authenticated: true, configured: true, ok: true };
  if (url.pathname.endsWith("/api/apps") && (!options.method || options.method === "GET")) {
    const id = url.searchParams.get("id");
    return id ? demoApps.find((app) => app.id === id) : { apps: demoApps.map(({ html, ...app }) => app) };
  }
  throw new Error("演示模式不会改动数据");
}

function sortApps(apps) {
  return [...apps].sort((a, b) => {
    if (Boolean(a.favorite) !== Boolean(b.favorite)) return Number(b.favorite) - Number(a.favorite);
    if (Number(a.order) !== Number(b.order)) return Number(a.order) - Number(b.order);
    return String(b.lastOpenedAt || b.updatedAt || b.createdAt).localeCompare(String(a.lastOpenedAt || a.updatedAt || a.createdAt));
  });
}

function syncCollections() {
  state.apps = sortApps(state.records.filter((record) => !record.deletedAt));
  state.trash = [...state.records.filter((record) => record.deletedAt)].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  $("#trashCount").textContent = `${state.trash.length} 个项目`;
}

function filteredApps() {
  const query = $("#searchInput").value.trim().toLowerCase();
  let apps = state.apps.filter((app) => `${app.title} ${app.subtitle} ${app.folder} ${(app.tags || []).join(" ")}`.toLowerCase().includes(query));
  const { type, value } = state.filter;
  if (type === "favorite") apps = apps.filter((app) => app.favorite);
  if (type === "recent") apps = apps.filter((app) => app.lastOpenedAt).sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)));
  if (type === "folder") apps = apps.filter((app) => app.folder === value);
  if (type === "tag") apps = apps.filter((app) => (app.tags || []).includes(value));
  return apps;
}

function renderFilterBar() {
  const folders = [...new Set(state.apps.map((app) => app.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const tags = [...new Set(state.apps.flatMap((app) => app.tags || []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const chips = [
    { type: "all", value: "", label: "全部" }, { type: "favorite", value: "", label: "收藏" },
    { type: "recent", value: "", label: "最近" },
    ...folders.map((value) => ({ type: "folder", value, label: `匣 · ${value}` })),
    ...tags.map((value) => ({ type: "tag", value, label: `# ${value}` }))
  ];
  $("#filterBar").innerHTML = chips.map((chip) => {
    const active = state.filter.type === chip.type && state.filter.value === chip.value;
    return `<button class="${active ? "active" : ""}" type="button" data-filter-type="${chip.type}" data-filter-value="${escapeHTML(chip.value)}">${escapeHTML(chip.label)}</button>`;
  }).join("");
}

function applyGridDensity(value = localStorage.getItem(GRID_DENSITY_KEY) || "3") {
  const density = ["2", "3", "4"].includes(String(value)) ? String(value) : "3";
  document.documentElement.dataset.gridDensity = density;
  localStorage.setItem(GRID_DENSITY_KEY, density);
  if ($("#gridDensity")) $("#gridDensity").value = density;
}

function themeCardVariantStyle(index) {
  const variants = state.activeTheme?.cards?.variants || [];
  if (!variants.length) return "";
  return Object.entries(variants[index % variants.length]).map(([key, value]) => `${key}:${value}`).join(";");
}

function renderApps() {
  renderFilterBar();
  const visible = filteredApps();
  $("#appCount").textContent = `${state.apps.length} ${state.apps.length === 1 ? "ITEM" : "ITEMS"}`;
  $("#emptyState").hidden = visible.length > 0;
  $("#manageButton").textContent = state.multiSelect ? "完成" : "管理";
  $("#batchBar").hidden = !state.multiSelect;
  updateBatchBar();
  $("#appGrid").innerHTML = visible.map((app, index) => {
    const cardIndex = Math.max(0, state.apps.findIndex((item) => item.id === app.id));
    const [bg, fg] = paletteFor(app, cardIndex);
    const selected = state.selected.has(app.id);
    const badges = [app.folder, ...(app.tags || []).slice(0, 2)].filter(Boolean);
    const variantStyle = themeCardVariantStyle(cardIndex);
    return `<article class="app-card${selected ? " is-selected" : ""}${state.multiSelect ? " is-selecting" : ""}" data-id="${escapeHTML(app.id)}" data-card-index="${cardIndex}" data-has-icon="${app.icon ? "true" : "false"}" data-icon-background="${app.iconBackground}" style="--card-animation-delay:${Math.min(index * 35, 210)}ms;${escapeHTML(variantStyle)}">
      <button type="button" aria-label="${state.multiSelect ? "选择" : "打开"} ${escapeHTML(app.title)}">
        <span class="app-icon" style="--icon-bg:${escapeHTML(bg)};--icon-fg:${escapeHTML(fg)}">${iconHTML(app)}<span class="card-decoration" aria-hidden="true"><i class="card-decoration-line"></i><i class="card-inner-frame"></i><i class="card-highlight"></i></span>${app.favorite ? '<i class="favorite-star">★</i>' : ""}<i class="selection-mark">✓</i></span>
        <span class="card-copy"><strong>${escapeHTML(app.title)}</strong><small>${escapeHTML(app.subtitle || formatDate(app.updatedAt))}</small>
        ${badges.length ? `<span class="card-badges">${badges.map((badge) => `<i>${escapeHTML(badge)}</i>`).join("")}</span>` : ""}</span>
      </button></article>`;
  }).join("");
  $$(".app-card").forEach((card) => {
    let timer; let longPressed = false;
    const id = card.dataset.id;
    const start = () => {
      if (state.multiSelect) return;
      longPressed = false;
      timer = setTimeout(() => { longPressed = true; openActions(id); navigator.vibrate?.(25); }, 520);
    };
    const clear = () => clearTimeout(timer);
    card.addEventListener("pointerdown", start); card.addEventListener("pointerup", clear);
    card.addEventListener("pointercancel", clear); card.addEventListener("pointermove", clear);
    card.querySelector("button").addEventListener("click", (event) => {
      if (longPressed) { event.preventDefault(); return; }
      if (state.multiSelect) toggleSelected(id); else openViewer(id);
    });
    card.addEventListener("contextmenu", (event) => { event.preventDefault(); if (!state.multiSelect) openActions(id); });
  });
}

function formatDate(value) { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value)); }

async function loadApps() {
  const data = await api("./api/apps");
  state.records = (data.apps || []).map(normalizeRecord);
  syncCollections(); renderApps();
}

function showSheet(element) {
  $$(".sheet").forEach((sheet) => { sheet.hidden = true; });
  const overViewer = !$("#viewer").hidden;
  element.classList.toggle("over-viewer", overViewer);
  $("#scrim").classList.toggle("over-viewer", overViewer);
  $("#scrim").hidden = false; element.hidden = false; document.body.style.overflow = "hidden";
}

function closeSheets() {
  $$(".sheet").forEach((sheet) => { sheet.hidden = true; });
  $("#scrim").hidden = true; $("#scrim").classList.remove("over-viewer");
  document.body.style.overflow = $("#viewer").hidden ? "" : "hidden";
}

function updateIconPreview() {
  const app = { title: $("#titleInput").value || "H", icon: $("#htmlInput").dataset.icon || "", iconBackground: $("#htmlInput").dataset.iconBackground || "transparent" };
  const [bg, fg] = paletteFor({ ...app, themeColor: $("#htmlInput").dataset.themeColor || "" });
  $("#iconPreview").style.setProperty("--icon-bg", bg); $("#iconPreview").style.setProperty("--icon-fg", fg);
  $("#iconPreview").dataset.hasIcon = app.icon ? "true" : "false";
  $("#iconPreview").dataset.iconBackground = app.iconBackground;
  $("#iconPreview").innerHTML = iconHTML(app);
  $$('[data-icon-background]').forEach((button) => button.classList.toggle("active", button.dataset.iconBackground === app.iconBackground));
}

function openEditor(record = null) {
  state.editingId = record?.id || null;
  state.editingOriginal = record ? cloneJSON(record, null) : null;
  $("#editorTitle").textContent = record ? "编辑应用" : "放入新应用";
  $("#titleInput").value = record?.title || ""; $("#subtitleInput").value = record?.subtitle || "";
  $("#folderInput").value = record?.folder || ""; $("#tagsInput").value = (record?.tags || []).join(", ");
  $("#htmlInput").value = record?.html || ""; $("#htmlInput").dataset.icon = record?.icon || "";
  $("#htmlInput").dataset.iconBackground = record?.iconBackground === "palette" ? "palette" : "transparent";
  $("#htmlInput").dataset.themeColor = record?.themeColor || "";
  $("#fileInput").value = ""; $("#iconFileInput").value = ""; $("#editorError").textContent = "";
  updateCodeStats(); updateIconPreview(); renderEditorCompatibility(record?.html || ""); showSheet($("#editorSheet"));
}

function extractMeta(html, fileName = "") {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  const title = documentNode.querySelector("title")?.textContent?.trim() || fileName.replace(/\.html?$/i, "");
  const theme = documentNode.querySelector('meta[name="theme-color"]')?.getAttribute("content") || "";
  const icon = documentNode.querySelector('link[rel~="icon" i], link[rel="apple-touch-icon" i]')?.getAttribute("href") || "";
  return { title, themeColor: /^#[0-9a-f]{6}$/i.test(theme) ? theme : palettes[hash(title || fileName) % palettes.length][0], icon: /^(data:image\/|https?:\/\/)/i.test(icon) ? icon : "" };
}

function analyzeHTML(html) {
  const source = String(html || "");
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  const issues = [];
  const external = new Map();
  const add = (level, title, detail) => issues.push({ level, title, detail });
  const viewport = documentNode.querySelector('meta[name="viewport" i]')?.getAttribute("content") || "";
  if (!viewport) add("risk", "缺少移动端 viewport", "手机上可能缩成电脑版宽度，文字和按钮会显得很小。");
  else if (!/width\s*=\s*device-width/i.test(viewport)) add("warn", "viewport 没有使用设备宽度", viewport);
  if (/(?:width|min-width)\s*:\s*(?:[5-9]\d\d|\d{4,})px/i.test(source)) add("warn", "发现较大的固定宽度", "窄屏上可能横向溢出，可考虑 max-width: 100%。");
  if (/(?:html|body)[^{]*\{[^}]*overflow\s*:\s*hidden/i.test(source) || /touchmove[^\n]{0,100}preventDefault/i.test(source)) add("warn", "页面可能锁住滚动", "若内容高于屏幕，底部区域可能无法触达。");
  if (documentNode.querySelector("iframe")) add("warn", "使用了内嵌网页", "iframe 内容受网络与目标站点限制，离线时通常不可用。");
  const collect = (selector, attribute, type) => documentNode.querySelectorAll(selector).forEach((node) => {
    const value = String(node.getAttribute(attribute) || "").trim();
    if (/^(?:https?:)?\/\//i.test(value)) external.set(value, type);
  });
  collect("script[src]", "src", "脚本"); collect('link[href][rel~="stylesheet" i]', "href", "样式");
  collect("img[src]", "src", "图片"); collect("audio[src], video[src], source[src]", "src", "媒体");
  collect("iframe[src]", "src", "内嵌网页"); collect('link[href][rel~="icon" i]', "href", "图标");
  for (const match of source.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^)'"\s]+)[^)]*\)/gi)) external.set(match[1], "CSS 资源");
  if (external.size) add("risk", `依赖 ${external.size} 个外部资源`, "断网、跨域限制或源站失效时，相关内容可能无法加载。");
  if (!issues.length) add("ok", "适合放进里间", "没有发现明显的移动端或离线风险。");
  const risk = issues.filter((item) => item.level === "risk").length;
  const warn = issues.filter((item) => item.level === "warn").length;
  return { status: risk ? "risk" : warn ? "warn" : "ok", issues, external: [...external].map(([url, type]) => ({ url, type })) };
}

function compatibilitySummary(report) {
  if (report.status === "ok") return "检查通过";
  const risks = report.issues.filter((item) => item.level === "risk").length;
  const warnings = report.issues.filter((item) => item.level === "warn").length;
  return [risks ? `${risks} 项风险` : "", warnings ? `${warnings} 项提醒` : ""].filter(Boolean).join(" · ");
}

function renderEditorCompatibility(html) {
  const report = analyzeHTML(html);
  state.compatibilityDraft = report;
  $("#compatReport").hidden = !String(html).trim();
  $("#compatTitle").textContent = report.status === "ok" ? "兼容性良好" : "兼容性检查";
  $("#compatSummary").textContent = compatibilitySummary(report);
  $("#compatList").innerHTML = report.issues.slice(0, 3).map((item) => `<li data-level="${item.level}"><strong>${escapeHTML(item.title)}</strong> · ${escapeHTML(item.detail)}</li>`).join("");
}

async function openCompatibility(id) {
  const app = await getFullApp(id);
  const report = analyzeHTML(app.html);
  $("#compatAppTitle").textContent = app.title;
  $("#compatAppSummary").textContent = compatibilitySummary(report);
  const resourceItems = report.external.map((item) => ({ level: "warn", title: item.type, detail: item.url }));
  $("#compatDetails").innerHTML = [...report.issues, ...resourceItems].map((item) => `<article class="compat-item" data-level="${item.level}"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></article>`).join("");
  showSheet($("#compatSheet"));
}

async function readFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { $("#editorError").textContent = "这份 HTML 超过 2 MB 了。"; return; }
  const html = await file.text(); const meta = extractMeta(html, file.name);
  $("#htmlInput").value = html;
  if (!$("#titleInput").value.trim()) $("#titleInput").value = meta.title;
  if (!$("#htmlInput").dataset.icon) $("#htmlInput").dataset.icon = meta.icon;
  $("#htmlInput").dataset.themeColor = meta.themeColor;
  updateCodeStats(); updateIconPreview(); renderEditorCompatibility(html); toast(`已读取 ${file.name}`);
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
}

async function readIcon(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) return toast("请选择图片文件");
  if (file.size > 1024 * 1024) return toast("图标图片请控制在 1 MB 以内");
  $("#htmlInput").dataset.icon = await fileToDataURL(file); updateIconPreview();
}

async function saveEditor() {
  const html = $("#htmlInput").value;
  const title = $("#titleInput").value.trim() || extractMeta(html).title || "未命名应用";
  if (!html.trim()) { $("#editorError").textContent = "还没有放入 HTML 内容。"; return; }
  const meta = extractMeta(html, title); const current = state.records.find((record) => record.id === state.editingId);
  const original = state.editingOriginal;
  const versions = [...(original?.versions || current?.versions || [])];
  if (original?.html && original.html !== html) {
    versions.unshift({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), title: original.title, html: original.html });
  }
  const payload = {
    title, subtitle: $("#subtitleInput").value.trim(), folder: $("#folderInput").value.trim(),
    tags: normalizeTags($("#tagsInput").value), html,
    icon: $("#htmlInput").dataset.icon || meta.icon, iconBackground: $("#htmlInput").dataset.iconBackground || "transparent", themeColor: $("#htmlInput").dataset.themeColor || meta.themeColor,
    favorite: current?.favorite || false, lastOpenedAt: current?.lastOpenedAt || null,
    order: current?.order ?? state.apps.length, versions: versions.slice(0, 5)
  };
  $("#saveButton").disabled = true;
  try {
    const path = state.editingId ? `./api/apps?id=${encodeURIComponent(state.editingId)}` : "./api/apps";
    const saved = await api(path, { method: state.editingId ? "PUT" : "POST", body: JSON.stringify(payload) });
    upsertMeta(saved); closeSheets(); renderApps(); toast(state.editingId ? "修改已保存" : "已经放进里间");
  } catch (error) { $("#editorError").textContent = friendlyError(error); }
  finally { $("#saveButton").disabled = false; }
}

function upsertMeta(record) {
  const meta = { ...normalizeRecord(record) }; delete meta.html;
  const index = state.records.findIndex((item) => item.id === meta.id);
  if (index >= 0) state.records[index] = meta; else state.records.push(meta);
  syncCollections();
}

async function updateApp(id, changes) {
  const saved = await api(`./api/apps?id=${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(changes) });
  upsertMeta(saved); if (state.activeApp?.id === id) state.activeApp = { ...state.activeApp, ...saved }; return saved;
}

async function getFullApp(id) {
  const current = state.activeApp?.id === id ? state.activeApp : null;
  if (current?.html) return current;
  const record = await api(`./api/apps?id=${encodeURIComponent(id)}`); state.activeApp = record; return record;
}

async function openViewer(id) {
  try {
    const record = await getFullApp(id); const openedAt = new Date().toISOString();
    const runtimeState = await getRuntimeState(id);
    record.lastOpenedAt = openedAt; state.activeApp = record;
    const runtimeSession = crypto.randomUUID();
    state.activeRuntimeSession = runtimeSession;
    localStorage.setItem(LAST_APP_KEY, id);
    await updateApp(id, { lastOpenedAt: openedAt, _touchOnly: true });
    state.effectiveViewerZoom = viewerPreferencesFor(id).zoom / 100;
    $("#viewerTitle").textContent = record.title;
    $("#appFrame").srcdoc = buildRuntimeDocument(record.html, id, runtimeState, runtimeSession);
    $("#viewer").hidden = false; document.body.style.overflow = "hidden";
    applyViewerPreferences();
    requestAnimationFrame(updateLandscapePreview);
    renderApps();
  } catch (error) { toast(friendlyError(error)); }
}

async function closeViewer() {
  const frame = $("#appFrame");
  if (!$("#viewer").hidden && frame.contentWindow) {
    frame.contentWindow.postMessage({ channel: "page-vault-runtime-v1", type: "flush" }, "*");
    await new Promise((resolve) => setTimeout(resolve, 80));
    await state.runtimeSaveChain;
  }
  closeViewerControls(); closeViewerMenu(); closeSwitcher(); setImmersive(false);
  state.activeRuntimeSession = null;
  $("#viewer").hidden = true; frame.srcdoc = ""; document.body.style.overflow = "";
}

async function clearRuntimeStateAndRefresh(id) {
  if (!id) return;
  const viewerOpen = !$("#viewer").hidden && state.activeApp?.id === id;
  const frame = $("#appFrame");

  if (viewerOpen) {
    state.activeRuntimeSession = `clearing-${crypto.randomUUID()}`;
    frame.srcdoc = "";
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  await state.runtimeSaveChain.catch(() => {});
  await deleteRuntimeState(id);

  if (viewerOpen) {
    const record = await getFullApp(id);
    const runtimeSession = crypto.randomUUID();
    state.activeRuntimeSession = runtimeSession;
    frame.srcdoc = buildRuntimeDocument(record.html, id, normalizeRuntimeState(id), runtimeSession);
    applyViewerPreferences();
    requestAnimationFrame(updateLandscapePreview);
  }
}

function openActions(id) {
  const app = state.apps.find((item) => item.id === id) || state.activeApp;
  if (!app) return;
  state.activeApp = app; const [bg] = paletteFor(app);
  $("#actionTitle").textContent = app.title;
  $("#actionSubtitle").textContent = [app.folder, ...(app.tags || [])].filter(Boolean).join(" · ") || app.subtitle || "HTML 应用";
  $("#actionIcon").dataset.hasIcon = app.icon ? "true" : "false";
  $("#actionIcon").dataset.iconBackground = app.iconBackground;
  $("#actionIcon").style.setProperty("--icon-bg", bg); $("#actionIcon").innerHTML = iconHTML(app);
  $("#favoriteActionText").textContent = app.favorite ? "取消收藏" : "收藏置顶"; showSheet($("#actionsSheet"));
}

function closeViewerMenu() { $("#viewerMenu").hidden = true; }
function openViewerMenu() { $("#viewerMenu").hidden = false; }

function closeSwitcher() { $("#switcher").hidden = true; }
function openSwitcher() {
  const recent = [...state.apps].sort((a, b) => String(b.lastOpenedAt || "").localeCompare(String(a.lastOpenedAt || "")));
  $("#switcherList").innerHTML = recent.map((app) => {
    const [bg] = paletteFor(app);
    return `<button type="button" data-switch-id="${escapeHTML(app.id)}" class="${app.id === state.activeApp?.id ? "active" : ""}"><span class="mini-icon" data-has-icon="${app.icon ? "true" : "false"}" data-icon-background="${app.iconBackground}" style="--icon-bg:${bg}">${iconHTML(app)}</span><span><strong>${escapeHTML(app.title)}</strong><small>${escapeHTML(app.subtitle || "HTML 应用")}</small></span><i>›</i></button>`;
  }).join("");
  $("#switcher").hidden = false;
}

async function flushActiveViewer() {
  const frame = $("#appFrame");
  if (!$("#viewer").hidden && frame.contentWindow) {
    frame.contentWindow.postMessage({ channel: "page-vault-runtime-v1", type: "flush" }, "*");
    await new Promise((resolve) => setTimeout(resolve, 90));
    await state.runtimeSaveChain;
  }
}

async function switchViewerApp(id) {
  if (!id || id === state.activeApp?.id) { closeSwitcher(); return; }
  await flushActiveViewer(); closeSwitcher(); state.activeApp = null; await openViewer(id);
}

function downloadRecord(record) { downloadBlob(new Blob([record.html], { type: "text/html;charset=utf-8" }), `${safeFileName(record.title)}.html`); }
function downloadBlob(blob, name) {
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

async function duplicateApp(id) {
  const original = await getFullApp(id);
  const now = new Date().toISOString();
  const record = normalizeRecord({
    ...original, id: crypto.randomUUID(), title: `${original.title} · 副本`, favorite: false,
    lastOpenedAt: null, deletedAt: null, createdAt: now, updatedAt: now,
    order: state.apps.length, versions: []
  });
  await withStore("readwrite", (store) => store.add(record));
  upsertMeta(record); renderApps(); toast("已复制为独立应用");
  return record;
}

async function openDataManager(id) {
  const app = await getFullApp(id);
  const runtime = await getRuntimeState(id);
  state.dataTargetId = id;
  const htmlBytes = new Blob([app.html]).size;
  const dataBytes = new Blob([JSON.stringify(runtime)]).size;
  $("#dataAppTitle").textContent = app.title;
  const snapshots = await getRuntimeSnapshots(id);
  const snapshotBytes = new Blob([JSON.stringify(snapshots)]).size;
  $("#dataSize").textContent = `HTML ${formatBytes(htmlBytes)} · 保存数据 ${formatBytes(dataBytes)} · 快照 ${formatBytes(snapshotBytes)}`;
  renderSnapshotList(snapshots);
  showSheet($("#dataSheet"));
}

function renderSnapshotList(snapshots) {
  $("#snapshotList").innerHTML = snapshots.length ? snapshots.map((snapshot) => `<article class="snapshot-item" data-snapshot-id="${escapeHTML(snapshot.id)}"><div><strong>${escapeHTML(snapshot.reason || "数据快照")}</strong><small>${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.createdAt))} · ${formatBytes(new Blob([JSON.stringify(snapshot.runtime)]).size)}</small></div><span class="snapshot-actions"><button type="button" data-snapshot-action="restore">恢复</button><button type="button" data-snapshot-action="delete">删除</button></span></article>`).join("") : '<div class="trash-empty">还没有数据快照。</div>';
}

async function refreshSnapshotList() {
  if (!state.dataTargetId) return;
  renderSnapshotList(await getRuntimeSnapshots(state.dataTargetId));
}

async function restoreRuntimeSnapshot(snapshotId) {
  const snapshots = await getRuntimeSnapshots(state.dataTargetId);
  const target = snapshots.find((item) => item.id === snapshotId); if (!target) return;
  if (!confirm("恢复这份数据快照吗？当前数据会先自动留一份。")) return;
  await createRuntimeSnapshot(state.dataTargetId, "恢复前自动保存", true);
  await replaceRuntimeStateAndRefresh(state.dataTargetId, target.runtime);
  await refreshSnapshotList(); toast("数据快照已恢复");
}

async function replaceRuntimeStateAndRefresh(id, runtime) {
  const viewerOpen = !$("#viewer").hidden && state.activeApp?.id === id;
  const frame = $("#appFrame");
  if (viewerOpen) { state.activeRuntimeSession = `replacing-${crypto.randomUUID()}`; frame.srcdoc = ""; await new Promise((resolve) => setTimeout(resolve, 80)); }
  await state.runtimeSaveChain.catch(() => {});
  await putRuntimeStates([{ ...runtime, id }]);
  if (viewerOpen) {
    const record = await getFullApp(id); const runtimeSession = crypto.randomUUID(); state.activeRuntimeSession = runtimeSession;
    frame.srcdoc = buildRuntimeDocument(record.html, id, normalizeRuntimeState(id, runtime), runtimeSession);
    applyViewerPreferences(); requestAnimationFrame(updateLandscapePreview);
  }
}

async function exportAppData() {
  const id = state.dataTargetId; if (!id) return;
  const app = await getFullApp(id); const runtime = await getRuntimeState(id);
  const payload = { format: "lijian-app-data", version: 1, exportedAt: new Date().toISOString(), appId: id, appTitle: app.title, runtime };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFileName(app.title)}-数据.lijian-data`);
  toast("应用数据已导出");
}

async function importAppData(file) {
  const id = state.dataTargetId; if (!id || !file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "lijian-app-data" || !payload.runtime) throw new Error("invalid_app_data");
    await createRuntimeSnapshot(id, "导入前自动保存", true);
    await replaceRuntimeStateAndRefresh(id, payload.runtime);
    toast("应用数据已导入"); closeSheets();
  } catch { toast("这不是有效的里间应用数据"); }
  finally { $("#dataImportInput").value = ""; }
}

async function clearManagedAppData() {
  const id = state.dataTargetId; if (!id) return;
  const app = state.apps.find((item) => item.id === id) || state.activeApp;
  if (!confirm(`清空“${app?.title || "这个应用"}”保存的数据吗？`)) return;
  await createRuntimeSnapshot(id, "清空前自动保存", true);
  await clearRuntimeStateAndRefresh(id);
  toast("应用数据已清空，页面已重新载入"); closeSheets();
}

async function openVersions(id) {
  const app = await getFullApp(id); state.dataTargetId = id;
  const versions = app.versions || [];
  $("#versionsList").innerHTML = versions.length ? versions.map((version, index) => `<article class="version-item"><div><strong>${escapeHTML(version.title)}</strong><small>${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(version.savedAt))}</small></div><span class="version-actions"><button type="button" data-version-compare="${index}">对比</button><button type="button" data-version-index="${index}">恢复</button></span></article>`).join("") : '<div class="trash-empty">还没有旧版本。</div>';
  showSheet($("#versionsSheet"));
}

function buildLineDiff(oldText, newText) {
  const oldLines = String(oldText).split("\n"); const newLines = String(newText).split("\n");
  if (oldLines.length * newLines.length > 90000) {
    let start = 0; while (oldLines[start] === newLines[start] && start < Math.min(oldLines.length, newLines.length)) start += 1;
    let end = 0; while (oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end] && end < Math.min(oldLines.length - start, newLines.length - start)) end += 1;
    const changedOld = oldLines.slice(start, oldLines.length - end).slice(0, 180).map((line) => `<span class="diff-del">− ${escapeHTML(line)}</span>`);
    const changedNew = newLines.slice(start, newLines.length - end).slice(0, 180).map((line) => `<span class="diff-add">+ ${escapeHTML(line)}</span>`);
    return [...oldLines.slice(Math.max(0, start - 3), start).map((line) => `<span class="diff-same">  ${escapeHTML(line)}</span>`), ...changedOld, ...changedNew, ...newLines.slice(newLines.length - end, newLines.length - end + 3).map((line) => `<span class="diff-same">  ${escapeHTML(line)}</span>`)].join("");
  }
  const rows = oldLines.length + 1; const cols = newLines.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) for (let j = newLines.length - 1; j >= 0; j -= 1) table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const output = []; let i = 0; let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { output.push(`<span class="diff-same">  ${escapeHTML(oldLines[i])}</span>`); i += 1; j += 1; }
    else if (j < newLines.length && (i === oldLines.length || table[i][j + 1] >= table[i + 1][j])) { output.push(`<span class="diff-add">+ ${escapeHTML(newLines[j])}</span>`); j += 1; }
    else { output.push(`<span class="diff-del">− ${escapeHTML(oldLines[i])}</span>`); i += 1; }
  }
  return output.join("");
}

async function openVersionDiff(index) {
  const app = await getFullApp(state.dataTargetId); const target = app.versions?.[Number(index)]; if (!target) return;
  $("#diffSummary").textContent = `${formatDate(target.savedAt)} 的旧版本 → 当前版本`;
  $("#versionDiff").innerHTML = buildLineDiff(target.html, app.html);
  showSheet($("#diffSheet"));
}

async function restoreVersion(index) {
  const id = state.dataTargetId; const app = await getFullApp(id);
  const target = app.versions?.[Number(index)]; if (!target) return;
  if (!confirm(`恢复到 ${formatDate(target.savedAt)} 的 HTML 吗？当前版本也会被保留。`)) return;
  const versions = [{ id: crypto.randomUUID(), savedAt: new Date().toISOString(), title: app.title, html: app.html }, ...app.versions.filter((_, i) => i !== Number(index))].slice(0, 5);
  await updateApp(id, { html: target.html, versions });
  state.activeApp = null; closeSheets(); toast("旧版本已恢复");
}

function openReorder() {
  state.reorderDraft = [...state.apps]; renderReorder(); showSheet($("#reorderSheet"));
}

function renderReorder() {
  $("#reorderList").innerHTML = state.reorderDraft.map((app, index) => {
    const [bg] = paletteFor(app);
    return `<article class="reorder-item" draggable="true" data-order-id="${escapeHTML(app.id)}"><span class="drag-grip">⋮⋮</span><span class="mini-icon" data-has-icon="${app.icon ? "true" : "false"}" data-icon-background="${app.iconBackground}" style="--icon-bg:${bg}">${iconHTML(app)}</span><strong>${escapeHTML(app.title)}</strong><span class="reorder-buttons"><button type="button" data-move="up" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-move="down" ${index === state.reorderDraft.length - 1 ? "disabled" : ""}>↓</button></span></article>`;
  }).join("");
}

function moveReorderItem(id, direction) {
  const from = state.reorderDraft.findIndex((app) => app.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= state.reorderDraft.length) return;
  const [item] = state.reorderDraft.splice(from, 1); state.reorderDraft.splice(to, 0, item); renderReorder();
}

async function saveReorder() {
  for (let index = 0; index < state.reorderDraft.length; index += 1) await updateApp(state.reorderDraft[index].id, { order: index, _touchOnly: true });
  closeSheets(); renderApps(); toast("应用顺序已保存");
}

async function moveToTrash(ids) {
  const deletedAt = new Date().toISOString();
  for (const id of ids) await updateApp(id, { deletedAt });
  state.activeApp = null; state.selected.clear(); state.multiSelect = false; renderApps();
}

async function handleAction(action) {
  const app = state.activeApp; if (!app) return; closeSheets();
  if (action === "open") return openViewer(app.id);
  if (action === "duplicate") return duplicateApp(app.id);
  if (action === "data") return openDataManager(app.id);
  if (action === "versions") return openVersions(app.id);
  if (action === "compat") return openCompatibility(app.id);
  if (action === "favorite") {
    try { await updateApp(app.id, { favorite: !app.favorite }); renderApps(); toast(app.favorite ? "已取消收藏" : "已收藏置顶"); }
    catch (error) { toast(friendlyError(error)); } return;
  }
  if (action === "clear-data") {
    if (!confirm(`清除“${app.title}”在里间里自动保存的填写内容和页面数据吗？HTML 本身不会删除。`)) return;
    try { await createRuntimeSnapshot(app.id, "清除前自动保存", true); await clearRuntimeStateAndRefresh(app.id); toast("应用数据已清除"); }
    catch { toast("刚才没有清除成功"); }
    return;
  }
  const full = await getFullApp(app.id);
  if (action === "edit") return openEditor(full);
  if (action === "download") return downloadRecord(full);
  if (action === "share") {
    try {
      const file = new File([full.html], `${safeFileName(full.title)}.html`, { type: "text/html" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: full.title, files: [file] });
      else { downloadRecord(full); toast("设备不支持直接分享，已下载 HTML"); }
    } catch (error) { if (error.name !== "AbortError") toast("刚才没有分享成功"); }
    return;
  }
  if (action === "delete") {
    if (!confirm(`把“${app.title}”移到回收站吗？`)) return;
    try { await moveToTrash([app.id]); toast("已移到回收站"); } catch (error) { toast(friendlyError(error)); }
  }
}

function safeFileName(value) { return String(value || "app").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80); }
function updateCodeStats() { $("#codeStats").textContent = `${$("#htmlInput").value.length.toLocaleString("zh-CN")} 字符`; }
function toast(message) {
  const element = $("#toast"); element.textContent = message; element.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 2200);
}

function friendlyError(error) {
  const map = { unauthorized: "里间已经锁上，请重新进入。", wrong_password: "密码不对。", empty_password: "先写一个密码。", not_found: "这份应用已经不存在了。" };
  return map[error.message] || "刚才没有保存成功，再试一次。";
}

function applyTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  $$("[data-theme]").forEach((button) => button.classList.toggle("active", button.dataset.theme === theme));
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $('meta[name="theme-color"]').content = dark ? "#171715" : "#f0ede6";
  if (state.apps.length) renderApps();
  if (!$("#editorSheet").hidden) updateIconPreview();
}

function showLogin(configured, error = "") {
  $("#loginTitle").textContent = configured ? "打开里间" : "设置里间密码";
  $("#loginDescription").textContent = configured ? "输入只属于你的访问密码。" : "首次打开，设置一个保存在这台设备上的密码。";
  $("#loginSubmit").textContent = configured ? "进入" : "设置并进入";
  $("#passwordInput").autocomplete = configured ? "current-password" : "new-password";
  $("#loginError").textContent = error; $("#loginScreen").hidden = false;
}

function lockMinutes() { return Number(localStorage.getItem(LOCK_TIMEOUT_KEY) || 0); }
function touchActivity() {
  if (!isUnlocked() || state.demo) return;
  sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); clearTimeout(state.lockTimer);
  const minutes = lockMinutes(); if (minutes > 0) state.lockTimer = setTimeout(lockVault, minutes * 60 * 1000);
}
function hasLockExpired() {
  const minutes = lockMinutes(); const last = Number(sessionStorage.getItem(LAST_ACTIVITY_KEY) || 0);
  return minutes > 0 && last > 0 && Date.now() - last >= minutes * 60 * 1000;
}
async function lockVault() {
  if (!isUnlocked() || state.demo) return;
  await api("./api/auth", { method: "DELETE" }); clearTimeout(state.lockTimer); closeSheets(); closeViewer(); exitMultiSelect(); showLogin(true);
}

function toggleSelected(id) { if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id); renderApps(); }
function enterMultiSelect() { state.multiSelect = true; state.selected.clear(); renderApps(); }
function exitMultiSelect() { state.multiSelect = false; state.selected.clear(); renderApps(); }
function updateBatchBar() {
  $("#selectedCount").textContent = `已选 ${state.selected.size} 项`;
  $$("#batchBar button").forEach((button) => { if (!["cancelBatch", "selectAllButton"].includes(button.id)) button.disabled = state.selected.size === 0; });
}

async function batchTags(mode) {
  const text = prompt(mode === "add" ? "输入要添加的标签，多个标签用逗号分隔" : "输入要移除的标签，多个标签用逗号分隔");
  const tags = normalizeTags(text); if (!tags.length) return;
  try {
    for (const id of state.selected) {
      const app = state.apps.find((item) => item.id === id);
      const next = mode === "add" ? [...new Set([...(app.tags || []), ...tags])] : (app.tags || []).filter((tag) => !tags.includes(tag));
      await updateApp(id, { tags: next });
    }
    renderApps(); toast(mode === "add" ? "标签已添加" : "标签已移除");
  } catch (error) { toast(friendlyError(error)); }
}

async function buildBackup() {
    const records = state.demo ? demoApps : (await withStore("readonly", (store) => store.getAll())).map(normalizeRecord);
    const appStates = state.demo ? [] : await withStore("readonly", (store) => store.getAll(), APP_STATE_STORE_NAME);
    const themes = state.demo ? [] : await withStore("readonly", (store) => store.getAll(), THEME_STORE_NAME);
    const snapshots = state.demo ? [] : await withStore("readonly", (store) => store.getAll(), SNAPSHOT_STORE_NAME);
    const settings = {
      appearance: localStorage.getItem(THEME_KEY) || "system",
      activeTheme: localStorage.getItem(ACTIVE_THEME_KEY) || "",
      previousTheme: localStorage.getItem(PREVIOUS_THEME_KEY) || "",
      lockTimeout: localStorage.getItem(LOCK_TIMEOUT_KEY) || "0",
      gridDensity: localStorage.getItem(GRID_DENSITY_KEY) || "3",
      lastApp: localStorage.getItem(LAST_APP_KEY) || ""
    };
    return { format: "lijian-backup", legacyFormat: "page-vault-backup", version: 7, exportedAt: new Date().toISOString(), apps: records, appStates, snapshots, themes, viewerPreferences: state.viewerPreferences, settings };
}

async function exportBackup() {
  try {
    const backup = await buildBackup();
    const records = backup.apps;
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), `里间备份_${new Date().toISOString().slice(0, 10)}.lijian`);
    closeSheets(); toast(`已备份 ${records.length} 个项目和应用数据`);
  } catch { toast("备份生成失败"); }
}

function bytesToBase64(bytes) {
  let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value) { return Uint8Array.from(atob(String(value)), (char) => char.charCodeAt(0)); }

async function backupKey(password, salt, usage) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 }, material, { name: "AES-GCM", length: 256 }, false, usage);
}

async function exportEncryptedBackup() {
  const password = prompt("给加密备份设置一个密码（至少 8 位）"); if (password === null) return;
  if (password.length < 8) return toast("备份密码至少 8 位");
  const repeated = prompt("再输入一次备份密码"); if (repeated !== password) return toast("两次密码不一致");
  try {
    const backup = await buildBackup(); const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await backupKey(password, salt, ["encrypt"]);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(backup)));
    const envelope = { format: "lijian-encrypted-backup", version: 1, algorithm: "AES-GCM", kdf: "PBKDF2-SHA-256", iterations: 250000, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
    downloadBlob(new Blob([JSON.stringify(envelope)], { type: "application/json;charset=utf-8" }), `里间加密备份_${new Date().toISOString().slice(0, 10)}.lijianx`);
    closeSheets(); toast("加密备份已生成");
  } catch { toast("加密备份生成失败"); }
}

async function decodeBackup(data) {
  if (data?.format !== "lijian-encrypted-backup") return data;
  const password = prompt("输入这份备份的密码"); if (password === null) throw new Error("cancelled");
  try {
    const salt = base64ToBytes(data.salt); const iv = base64ToBytes(data.iv); const key = await backupKey(password, salt, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(data.data));
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch { throw new Error("wrong_backup_password"); }
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const data = await decodeBackup(JSON.parse(await file.text()));
    if (!["page-vault-backup", "lijian-backup"].includes(data?.format) || !Array.isArray(data.apps)) throw new Error("invalid_backup");
    if (!confirm(`备份中有 ${data.apps.length} 个项目。相同项目会更新，继续恢复吗？`)) return;
    await putMany(data.apps);
    if (Array.isArray(data.appStates)) await putRuntimeStates(data.appStates);
    if (Array.isArray(data.snapshots)) await putRuntimeSnapshots(data.snapshots);
    if (Array.isArray(data.themes)) {
      for (const theme of data.themes) await withStore("readwrite", (store) => store.put(normalizeTheme(theme, theme.name)), THEME_STORE_NAME);
    }
    if (data.viewerPreferences && typeof data.viewerPreferences === "object") {
      state.viewerPreferences = { ...state.viewerPreferences, ...data.viewerPreferences };
      localStorage.setItem(VIEWER_PREFS_KEY, JSON.stringify(state.viewerPreferences));
    }
    if (data.settings && typeof data.settings === "object") {
      const mappings = [[THEME_KEY, data.settings.appearance], [ACTIVE_THEME_KEY, data.settings.activeTheme], [PREVIOUS_THEME_KEY, data.settings.previousTheme], [LOCK_TIMEOUT_KEY, data.settings.lockTimeout], [GRID_DENSITY_KEY, data.settings.gridDensity], [LAST_APP_KEY, data.settings.lastApp]];
      mappings.forEach(([key, value]) => value === undefined || value === null || value === "" ? localStorage.removeItem(key) : localStorage.setItem(key, String(value)));
      applyGridDensity(); applyTheme(localStorage.getItem(THEME_KEY) || "system");
    }
    await loadThemes();
    await loadApps(); closeSheets(); toast("备份和应用数据已经恢复");
  } catch (error) { if (error.message !== "cancelled") toast(error.message === "wrong_backup_password" ? "密码不对或备份文件已损坏" : "这不是有效的里间备份"); }
  finally { $("#restoreInput").value = ""; }
}

async function openStorageHealth() {
  try {
    const records = state.demo ? demoApps.map(normalizeRecord) : (await withStore("readonly", (store) => store.getAll())).map(normalizeRecord);
    const runtimeStates = state.demo ? [] : await withStore("readonly", (store) => store.getAll(), APP_STATE_STORE_NAME);
    const snapshots = state.demo ? [] : await withStore("readonly", (store) => store.getAll(), SNAPSHOT_STORE_NAME);
    const themes = state.demo ? [] : await withStore("readonly", (store) => store.getAll(), THEME_STORE_NAME);
    const sizeOf = (value) => new Blob([typeof value === "string" ? value : JSON.stringify(value)]).size;
    const htmlBytes = records.reduce((sum, item) => sum + sizeOf(item.html), 0);
    const dataBytes = runtimeStates.reduce((sum, item) => sum + sizeOf(item), 0);
    const snapshotBytes = snapshots.reduce((sum, item) => sum + sizeOf(item), 0);
    const themeBytes = themes.reduce((sum, item) => sum + sizeOf(item), 0);
    const knownBytes = htmlBytes + dataBytes + snapshotBytes + themeBytes;
    const estimate = await navigator.storage?.estimate?.() || {};
    const usage = Number(estimate.usage || knownBytes); const quota = Number(estimate.quota || 0); const percent = quota ? Math.min(100, usage / quota * 100) : 0;
    $("#storageOverview").innerHTML = `<div class="storage-card"><strong>${formatBytes(usage)} 已使用${quota ? ` / ${formatBytes(quota)}` : ""}</strong><small>浏览器总占用包含里间、缓存和其他站点数据；下方为里间可计算内容。</small><div class="storage-bar"><i style="width:${percent}%"></i></div></div><div class="storage-parts"><div><strong>${formatBytes(htmlBytes)}</strong><small>HTML</small></div><div><strong>${formatBytes(dataBytes)}</strong><small>应用数据</small></div><div><strong>${formatBytes(snapshotBytes + themeBytes)}</strong><small>快照与主题</small></div></div>`;
    const byApp = records.map((app) => ({ title: app.title, bytes: sizeOf(app.html) + runtimeStates.filter((item) => item.id === app.id).reduce((sum, item) => sum + sizeOf(item), 0) + snapshots.filter((item) => item.appId === app.id).reduce((sum, item) => sum + sizeOf(item), 0) })).sort((a, b) => b.bytes - a.bytes);
    $("#storageRanking").innerHTML = byApp.length ? byApp.map((item, index) => `<article class="storage-item"><div><strong>${index + 1}. ${escapeHTML(item.title)}</strong><small>${item.bytes >= knownBytes * .25 && knownBytes ? "占用较多" : "本机内容"}</small></div><b>${formatBytes(item.bytes)}</b></article>`).join("") : '<div class="trash-empty">还没有可统计的内容。</div>';
    showSheet($("#storageSheet"));
  } catch { toast("空间统计没有读取成功"); }
}

function renderThemes() {
  $("#themeCount").textContent = `${state.themes.length} 个`;
  const defaultActive = !state.activeTheme;
  const cards = [{ id: "", name: "里间默认", author: "内置", description: "恢复里间原本的纸张与墨色。", builtin: true }, ...state.themes];
  $("#themeList").innerHTML = cards.map((theme) => {
    const active = theme.builtin ? defaultActive : state.activeTheme?.id === theme.id;
    const initials = glyphFor(theme.name);
    return `<article class="theme-card${active ? " active" : ""}" data-theme-id="${escapeHTML(theme.id)}">
      <div class="theme-swatch"><span>${escapeHTML(initials)}</span><i></i><b></b></div>
      <div class="theme-meta"><strong>${escapeHTML(theme.name)}</strong><small>${escapeHTML(theme.author || "未署名")}${active ? " · 使用中" : ""}</small><p>${escapeHTML(theme.description || "自定义里间外观")}</p></div>
      <div class="theme-actions">
        <button type="button" data-theme-action="preview">预览</button><button type="button" data-theme-action="apply">${active ? "已应用" : "应用"}</button>
        ${theme.builtin ? "" : '<button type="button" data-theme-action="export">导出</button><button class="danger-text" type="button" data-theme-action="delete">删除</button>'}
      </div>
    </article>`;
  }).join("");
}

function openThemeWorkshop() {
  renderThemes();
  showSheet($("#themeSheet"));
}

async function importThemeFile(file) {
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("theme_file_too_large");
    const text = await file.text();
    let input;
    if (/\.css$/i.test(file.name) || file.type === "text/css") {
      input = { name: file.name.replace(/\.css$/i, ""), author: "", description: "从 CSS 文件导入", css: text };
    } else {
      input = JSON.parse(text);
      if (input?.format !== "page-vault-theme") throw new Error("invalid_theme");
    }
    const record = await saveTheme(input);
    applyCustomTheme(record);
    renderThemes();
    toast(`已应用“${record.name}”`);
  } catch (error) {
    const messages = {
      theme_file_too_large: "主题文件超过 5 MB。",
      theme_css_too_large: "主题里的 CSS 太大了。",
      theme_assets_too_large: "主题资源超过 4 MB。",
      theme_external_resource: "主题含有外部链接或不安全代码。",
      invalid_theme: "这不是有效的里间主题文件。"
    };
    toast(messages[error.message] || "主题文件无法读取");
  } finally {
    $("#themeFileInput").value = "";
  }
}

function exportTheme(theme) {
  const payload = { ...theme, format: "page-vault-theme", schemaVersion: 2 };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), `${safeFileName(theme.name)}.pvtheme`);
}

function downloadThemeTemplate() {
  const template = {
    format: "page-vault-theme", schemaVersion: 2, id: "my-theme", name: "我的主题", author: "",
    description: "v6 卡片系统主题：形状、比例、文字、装饰、配色、错落变化与上传图标均可控制。",
    variables: {
      "--bg": "#eee9df", "--paper": "#f8f4ec", "--ink": "#24211d", "--muted": "#777066",
      "--line": "rgba(36,33,29,.14)", "--line-strong": "rgba(36,33,29,.28)",
      "--card-grid-row-gap": "24px", "--card-grid-column-gap": "16px",
      "--card-width": "106px", "--card-aspect-ratio": "1", "--card-radius": "25%",
      "--card-border-width": "1px", "--card-border-style": "solid", "--card-border-color": "rgba(255,255,255,.24)",
      "--card-shadow": "0 12px 25px color-mix(in srgb, var(--icon-bg) 24%, transparent)",
      "--card-icon-margin": "0 auto 10px", "--card-icon-padding": "0px", "--card-icon-transform": "none",
      "--card-image-fit": "cover", "--card-image-radius": "0px", "--card-image-filter": "none", "--card-image-opacity": "1",
      "--card-text-align": "center", "--card-title-size": "13px", "--card-title-weight": "600",
      "--card-copy-position": "static", "--card-copy-inset": "auto", "--card-copy-padding": "0px", "--card-copy-background": "transparent",
      "--card-decoration-line-display": "none", "--card-inner-frame-display": "none", "--card-highlight-display": "none"
    },
    cards: {
      colorMode: "original",
      palette: [["#3c4038", "#f5efdf"], ["#5a3932", "#f7e8d9"], ["#243a3c", "#edf0e8"]],
      variants: []
    },
    assets: {},
    css: ".hero h2 { letter-spacing: -.055em; }\n/* 上传图标也会使用同一套边框与效果；可用 [data-has-icon=\"true\"] 单独调整。 */\n/* 规律错落示例：.app-card:nth-child(even) { --card-icon-transform: translateY(6px) rotate(1deg); } */\n/* 装饰层可分别开启并替换：line、inner-frame、highlight。 */\n/* 本地资源可写入 assets，然后在 CSS 使用 url(\"asset://资源名\")。 */"
  };
  downloadBlob(new Blob([JSON.stringify(template, null, 2)], { type: "application/json;charset=utf-8" }), "page-vault-theme-template.pvtheme");
  toast("主题模板已下载");
}

async function handleThemeAction(id, action) {
  const theme = state.themes.find((item) => item.id === id) || null;
  if (action === "preview") {
    const currentId = state.activeTheme?.id || "";
    applyCustomTheme(theme, false);
    const keep = confirm(theme ? `正在预览“${theme.name}”。保留这套主题吗？` : "正在预览里间默认主题。保留吗？");
    if (keep) {
      localStorage.setItem(PREVIOUS_THEME_KEY, currentId);
      applyCustomTheme(theme, true); toast("主题已保留");
    } else {
      const previous = state.themes.find((item) => item.id === currentId) || null;
      applyCustomTheme(previous, false); toast("已退出预览");
    }
    renderThemes(); return;
  }
  if (action === "apply") {
    localStorage.setItem(PREVIOUS_THEME_KEY, state.activeTheme?.id || "");
    applyCustomTheme(theme);
    renderThemes();
    toast(theme ? `已应用“${theme.name}”` : "已恢复默认外观");
    return;
  }
  if (!theme) return;
  if (action === "export") return exportTheme(theme);
  if (action === "delete") {
    if (!confirm(`删除主题“${theme.name}”吗？`)) return;
    await withStore("readwrite", (store) => store.delete(theme.id), THEME_STORE_NAME);
    state.themes = state.themes.filter((item) => item.id !== theme.id);
    if (state.activeTheme?.id === theme.id) applyCustomTheme(null);
    renderThemes();
    toast("主题已删除");
  }
}

function rollbackTheme() {
  const previousId = localStorage.getItem(PREVIOUS_THEME_KEY) || "";
  const currentId = state.activeTheme?.id || "";
  const previous = state.themes.find((theme) => theme.id === previousId) || null;
  localStorage.setItem(PREVIOUS_THEME_KEY, currentId);
  applyCustomTheme(previous, true); renderThemes();
  toast(previous ? `已恢复“${previous.name}”` : "已恢复里间默认主题");
}

function renderTrash() {
  $("#emptyTrashButton").disabled = state.trash.length === 0;
  $("#trashList").innerHTML = state.trash.length ? state.trash.map((app) => {
    const [bg, fg] = paletteFor(app);
    return `<article class="trash-item" data-id="${escapeHTML(app.id)}"><div class="mini-icon" data-has-icon="${app.icon ? "true" : "false"}" data-icon-background="${app.iconBackground}" style="--icon-bg:${bg};--icon-fg:${fg}">${iconHTML(app)}</div><div><strong>${escapeHTML(app.title)}</strong><small>${formatDate(app.deletedAt)} 删除</small></div><button type="button" data-trash-action="restore">恢复</button><button class="danger-text" type="button" data-trash-action="permanent">永久删除</button></article>`;
  }).join("") : '<div class="trash-empty">回收站是空的。</div>';
}

async function handleTrashAction(id, action) {
  const app = state.trash.find((item) => item.id === id); if (!app) return;
  try {
    if (action === "restore") { await updateApp(id, { deletedAt: null }); toast("已经恢复"); }
    else {
      if (!confirm(`永久删除“${app.title}”吗？这次无法恢复。`)) return;
      await api(`./api/apps?id=${encodeURIComponent(id)}&permanent=1`, { method: "DELETE" });
      state.records = state.records.filter((item) => item.id !== id); syncCollections(); toast("已经永久删除");
    }
    renderTrash(); renderApps();
  } catch (error) { toast(friendlyError(error)); }
}

async function emptyTrash() {
  if (!state.trash.length || !confirm(`永久删除回收站中的 ${state.trash.length} 个项目吗？`)) return;
  try {
    for (const app of [...state.trash]) await api(`./api/apps?id=${encodeURIComponent(app.id)}&permanent=1`, { method: "DELETE" });
    state.records = state.records.filter((record) => !record.deletedAt); syncCollections(); renderTrash(); renderApps(); toast("回收站已清空");
  } catch (error) { toast(friendlyError(error)); }
}

function installPwaRescueGesture() {
  let taps = 0;
  let lastTap = 0;
  window.addEventListener("pointerdown", (event) => {
    const inRescueCorner = event.clientX <= 110 && event.clientY <= 150;
    if (!inRescueCorner) { taps = 0; lastTap = 0; return; }
    const now = Date.now();
    taps = now - lastTap <= 1100 ? taps + 1 : 1;
    lastTap = now;
    if (taps < 7) return;
    taps = 0; lastTap = 0;
    event.preventDefault();
    localStorage.removeItem(ACTIVE_THEME_KEY);
    try { clearAppliedTheme(); } catch { /* the reload below is the final reset */ }
    alert("里间已关闭自定义主题，即将恢复默认外观。");
    location.reload();
  }, { capture: true, passive: false });
}

async function init() {
  $("#dateLabel").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  loadViewerPreferences();
  applyGridDensity();
  applyTheme(localStorage.getItem(THEME_KEY) || "system"); $("#lockTimeout").value = String(lockMinutes());
  if (hasLockExpired()) { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(LAST_ACTIVITY_KEY); }
  try {
    await loadThemes();
    const session = await api("./api/auth");
    if (!session.authenticated) showLogin(session.configured); else { await loadApps(); touchActivity(); }
  } catch { showLogin(Boolean(localStorage.getItem(PASSWORD_KEY)), "暂时无法读取设备存储。"); }
  finally { $("#app").classList.remove("is-loading"); }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#loginError").textContent = "";
  try {
    await api("./api/auth", { method: "POST", body: JSON.stringify({ password: $("#passwordInput").value }) });
    $("#loginScreen").hidden = true; $("#passwordInput").value = ""; await loadApps(); touchActivity();
  } catch (error) { $("#loginError").textContent = friendlyError(error); }
});
$("#showPassword").addEventListener("click", () => { const input = $("#passwordInput"); input.type = input.type === "password" ? "text" : "password"; });
[$("#addHeroButton"), $("#floatingAdd"), $("#emptyState")].forEach((button) => button.addEventListener("click", () => openEditor()));
$("#settingsButton").addEventListener("click", () => showSheet($("#settingsSheet")));
$("#scrim").addEventListener("click", closeSheets); $$("[data-close-sheet]").forEach((button) => button.addEventListener("click", closeSheets));
$("#uploadZone").addEventListener("click", () => $("#fileInput").click()); $("#fileInput").addEventListener("change", (event) => readFile(event.target.files[0]));
$("#chooseIconButton").addEventListener("click", () => $("#iconFileInput").click()); $("#iconFileInput").addEventListener("change", (event) => readIcon(event.target.files[0]));
$("#removeIconButton").addEventListener("click", () => { $("#htmlInput").dataset.icon = ""; updateIconPreview(); });
$$('[data-icon-background]').forEach((button) => button.addEventListener("click", () => { $("#htmlInput").dataset.iconBackground = button.dataset.iconBackground; updateIconPreview(); }));
let compatibilityTimer = 0;
$("#titleInput").addEventListener("input", updateIconPreview); $("#htmlInput").addEventListener("input", () => { updateCodeStats(); clearTimeout(compatibilityTimer); compatibilityTimer = setTimeout(() => renderEditorCompatibility($("#htmlInput").value), 240); }); $("#saveButton").addEventListener("click", saveEditor);
$("#searchInput").addEventListener("input", renderApps);
$("#filterBar").addEventListener("click", (event) => { const button = event.target.closest("[data-filter-type]"); if (!button) return; state.filter = { type: button.dataset.filterType, value: button.dataset.filterValue }; renderApps(); });
$$("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
$("#closeViewer").addEventListener("click", closeViewer); $("#viewerMore").addEventListener("click", openViewerMenu);
$("#viewerMenuScrim").addEventListener("click", closeViewerMenu);
$$('[data-viewer-action]').forEach((button) => button.addEventListener("click", async () => {
  const action = button.dataset.viewerAction; const id = state.activeApp?.id; closeViewerMenu(); if (!id) return;
  if (action === "switch") return openSwitcher();
  if (action === "edit") return openEditor(await getFullApp(id));
  if (action === "data") return openDataManager(id);
  if (action === "versions") return openVersions(id);
  if (action === "compat") return openCompatibility(id);
  if (action === "duplicate") return duplicateApp(id);
}));
[$("#switcherScrim"), $("#closeSwitcher")].forEach((button) => button.addEventListener("click", closeSwitcher));
$("#switcherList").addEventListener("click", (event) => { const button = event.target.closest("[data-switch-id]"); if (button) switchViewerApp(button.dataset.switchId); });
$("#viewerDisplayButton").addEventListener("click", openViewerControls);
[$("#viewerControlsScrim"), $("#closeViewerControls")].forEach((button) => button.addEventListener("click", closeViewerControls));
$("#zoomOutButton").addEventListener("click", () => setViewerZoom(viewerPreferencesFor().zoom - 10));
$("#zoomInButton").addEventListener("click", () => setViewerZoom(viewerPreferencesFor().zoom + 10));
$("#zoomResetButton").addEventListener("click", () => setViewerZoom(100));
$("#zoomRange").addEventListener("input", (event) => setViewerZoom(event.target.value));
$("#zoomPresets").addEventListener("click", (event) => {
  const button = event.target.closest("[data-zoom]");
  if (button) setViewerZoom(button.dataset.zoom);
});
$("#fitWidthButton").addEventListener("click", () => updateViewerPreference({ fitWidth: !viewerPreferencesFor().fitWidth }));
$("#landscapeButton").addEventListener("click", () => updateViewerPreference({ landscape: !viewerPreferencesFor().landscape }));
$("#scrollLockButton").addEventListener("click", () => {
  const scrollLocked = !viewerPreferencesFor().scrollLocked;
  updateViewerPreference({ scrollLocked });
  toast(scrollLocked ? "页面滑动已锁定" : "页面可以滑动了");
});
$("#immersiveButton").addEventListener("click", () => setImmersive(true));
$("#immersiveExit").addEventListener("click", () => setImmersive(false));
window.addEventListener("resize", () => { if (!$("#viewer").hidden) requestAnimationFrame(updateLandscapePreview); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || $("#viewer").hidden) return;
  if (!$("#viewerControls").hidden) closeViewerControls();
  else if ($("#viewer").classList.contains("immersive")) setImmersive(false);
});
$$("[data-theme]").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme)));
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if ((localStorage.getItem(THEME_KEY) || "system") === "system") applyTheme("system"); });
$("#logoutButton").addEventListener("click", lockVault);
$("#lockTimeout").addEventListener("change", (event) => { localStorage.setItem(LOCK_TIMEOUT_KEY, event.target.value); touchActivity(); toast("自动锁定时间已保存"); });
$("#backupButton").addEventListener("click", exportBackup); $("#encryptedBackupButton").addEventListener("click", exportEncryptedBackup); $("#restoreButton").addEventListener("click", () => $("#restoreInput").click());
$("#restoreInput").addEventListener("change", (event) => restoreBackup(event.target.files[0]));
$("#storageHealthButton").addEventListener("click", openStorageHealth);
$("#gridDensity").addEventListener("change", (event) => { applyGridDensity(event.target.value); toast("主页密度已保存"); });
$("#reorderButton").addEventListener("click", openReorder);
$("#saveOrderButton").addEventListener("click", saveReorder);
$("#reorderList").addEventListener("click", (event) => { const button = event.target.closest("[data-move]"); if (button) moveReorderItem(button.closest("[data-order-id]").dataset.orderId, button.dataset.move); });
let draggedOrderId = null;
$("#reorderList").addEventListener("dragstart", (event) => { const row = event.target.closest("[data-order-id]"); draggedOrderId = row?.dataset.orderId || null; event.dataTransfer.effectAllowed = "move"; });
$("#reorderList").addEventListener("dragover", (event) => event.preventDefault());
$("#reorderList").addEventListener("drop", (event) => {
  event.preventDefault(); const targetId = event.target.closest("[data-order-id]")?.dataset.orderId;
  if (!draggedOrderId || !targetId || draggedOrderId === targetId) return;
  const from = state.reorderDraft.findIndex((app) => app.id === draggedOrderId); const to = state.reorderDraft.findIndex((app) => app.id === targetId);
  const [item] = state.reorderDraft.splice(from, 1); state.reorderDraft.splice(to, 0, item); draggedOrderId = null; renderReorder();
});
$("#trashButton").addEventListener("click", () => { renderTrash(); showSheet($("#trashSheet")); });
$("#themeWorkshopButton").addEventListener("click", openThemeWorkshop);
$("#importThemeButton").addEventListener("click", () => $("#themeFileInput").click());
$("#themeFileInput").addEventListener("change", (event) => importThemeFile(event.target.files[0]));
$("#themeHelpButton").addEventListener("click", downloadThemeTemplate);
$("#themeRollbackButton").addEventListener("click", rollbackTheme);
$("#themeList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-action]"); if (!button) return;
  handleThemeAction(button.closest(".theme-card").dataset.themeId, button.dataset.themeAction);
});
$("#trashList").addEventListener("click", (event) => { const button = event.target.closest("[data-trash-action]"); if (!button) return; handleTrashAction(button.closest(".trash-item").dataset.id, button.dataset.trashAction); });
$("#emptyTrashButton").addEventListener("click", emptyTrash);
$("#exportAppDataButton").addEventListener("click", exportAppData);
$("#importAppDataButton").addEventListener("click", () => $("#dataImportInput").click());
$("#dataImportInput").addEventListener("change", (event) => importAppData(event.target.files[0]));
$("#clearAppDataButton").addEventListener("click", clearManagedAppData);
$("#createSnapshotButton").addEventListener("click", async () => { if (!state.dataTargetId) return; await createRuntimeSnapshot(state.dataTargetId); await refreshSnapshotList(); });
$("#snapshotList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-snapshot-action]"); if (!button) return;
  const row = button.closest("[data-snapshot-id]"); if (!row) return;
  if (button.dataset.snapshotAction === "restore") await restoreRuntimeSnapshot(row.dataset.snapshotId);
  else { await withStore("readwrite", (store) => store.delete(row.dataset.snapshotId), SNAPSHOT_STORE_NAME); await refreshSnapshotList(); toast("数据快照已删除"); }
});
$("#versionsList").addEventListener("click", (event) => { const compare = event.target.closest("[data-version-compare]"); if (compare) return openVersionDiff(compare.dataset.versionCompare); const button = event.target.closest("[data-version-index]"); if (button) restoreVersion(button.dataset.versionIndex); });
$("#manageButton").addEventListener("click", () => state.multiSelect ? exitMultiSelect() : enterMultiSelect()); $("#cancelBatch").addEventListener("click", exitMultiSelect);
$("#selectAllButton").addEventListener("click", () => { filteredApps().forEach((app) => state.selected.add(app.id)); renderApps(); });
$("#addTagsButton").addEventListener("click", () => batchTags("add")); $("#removeTagsButton").addEventListener("click", () => batchTags("remove"));
$("#batchDeleteButton").addEventListener("click", async () => {
  if (!state.selected.size || !confirm(`把选中的 ${state.selected.size} 个应用移到回收站吗？`)) return;
  try { await moveToTrash([...state.selected]); toast("已移到回收站"); } catch (error) { toast(friendlyError(error)); }
});

window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.deferredInstall = event; });
$("#installButton").addEventListener("click", async () => {
  if (state.deferredInstall) { state.deferredInstall.prompt(); await state.deferredInstall.userChoice; state.deferredInstall = null; closeSheets(); }
  else showSheet($("#installSheet"));
});
["pointerdown", "keydown"].forEach((eventName) => document.addEventListener(eventName, touchActivity, { passive: true }));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && hasLockExpired()) lockVault(); else if (document.visibilityState === "visible") touchActivity(); });
if ("serviceWorker" in navigator && !state.demo) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
installPwaRescueGesture();
init();

