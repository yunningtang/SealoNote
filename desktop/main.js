// Sealonote 桌面版
// 主窗口直接打开线上网站（www.sealonote.com），所以登录同一个账号就是同一份数据，网站更新了这里也跟着更新。
// 另外几种小窗口，打开的都是网站里没有侧栏的页面：
//  · 便签（#/sticky）：今天的焦点和安排 / 便利贴，可以置顶、调透明度
//  · 单张便利贴（#/sticky?note=<id>）：一页笔记贴在桌面上，可以开好几张，各自记位置和大小
//  · 汤圆（#/seal）：AI 对话单独一个窗口
//  · 桌面汤圆（#/pet）：透明的小窗口，汤圆坐在桌面上，跟着你打字拍鳍、显示番茄钟；只数按键次数，不记按了什么
// Windows / Linux 上所有窗口都没有系统标题栏：网页自己画标题栏和最小化 / 最大化 / 关闭按钮，和界面融在一起。
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, screen, session, systemPreferences, utilityProcess, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const SITE = process.env.SEALONOTE_URL || 'https://www.sealonote.com';
const ORIGIN = new URL(SITE).origin;
const PARTITION = 'persist:sealonote';
const MAC = process.platform === 'darwin';
// 允许留在应用里打开的地址：网站本身 + 登录要经过的页面（Supabase / Google 登录）
const AUTH_HOSTS = [/\.supabase\.co$/, /^accounts\.google\.com$/, /^accounts\.youtube\.com$/, /(^|\.)google\.[a-z.]+$/];
const ICON = path.join(__dirname, 'icon.png');

// 汤圆是 3D 的（WebGL）：有些显卡在 Chromium 的黑名单里，默认会关掉 WebGL，汤圆就只剩一张平面图。打开它
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// Windows 会把「被别的窗口挡住」的窗口停止绘制；透明的桌面汤圆窗口常被误判，汤圆就不见了，关掉这个判断
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let main = null, sticky = null, ai = null, pet = null, tray = null, quitting = false;
const notes = new Map(); // noteId → BrowserWindow

// ---- 设置（窗口位置、便签是否置顶 / 是否开着、开机启动）----
const cfgFile = () => path.join(app.getPath('userData'), 'window-state.json');
let cfg = {};
// 读坏了（写到一半断电、文件被改坏）就用上一次的临时文件，再不行用默认值
function loadCfg() { cfg = {}; for (const f of [cfgFile(), cfgFile() + '.tmp']) { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); if (v && typeof v === 'object') { cfg = v; break; } } catch {} } cfg.notes = cfg.notes && typeof cfg.notes === 'object' ? cfg.notes : {}; }
// 先写临时文件再换过去：写到一半崩了也不会把原来的设置弄坏
let saveT = null;
function writeCfgNow() { try { const tmp = cfgFile() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2)); fs.renameSync(tmp, cfgFile()); } catch {} }
function saveCfg() { clearTimeout(saveT); saveT = setTimeout(writeCfgNow, 300); }
// 记下来的位置要还在某个屏幕上，不然（拔了外接屏）就用默认位置
function onScreen(b) {
  if (!b) return false;
  return screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y >= w.y - 10 && b.y < w.y + w.height - 40);
}
function trackBounds(win, get, set) {
  const save = () => { if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) { set(win.getBounds()); saveCfg(); } };
  win.on('resize', save); win.on('move', save);
}
const keyed = (key) => [() => cfg[key], (b) => { cfg[key] = b; }];

function isAppUrl(u) { try { return new URL(u).origin === ORIGIN; } catch { return false; } }
function isAuthUrl(u) { try { const h = new URL(u).hostname; return AUTH_HOSTS.some((r) => r.test(h)); } catch { return false; } }

// 链接：网站内的留在窗口里；登录页留在窗口里；别的（外部链接、附件下载页）交给系统浏览器
function guard(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      const hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
      const m = hash.match(/^#\/sticky\?(?:.*&)?note=([\w-]+)/);
      if (m) showNote(m[1]); else if (/^#\/sticky/.test(hash)) showSticky(); else if (/^#\/seal/.test(hash)) showAI(); else showMain(hash);
      return { action: 'deny' };
    }
    if (isAuthUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, parent: win, modal: false, autoHideMenuBar: true, webPreferences: { partition: PARTITION } } };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url) || isAuthUrl(url)) return;
    e.preventDefault(); if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
  });
  // 最大化 / 还原时告诉网页，换按钮图标
  const tell = () => { if (!wc.isDestroyed()) wc.send('win:max', win.isMaximized()); };
  win.on('maximize', tell); win.on('unmaximize', tell);
}

function webPrefs() {
  return { partition: PARTITION, preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}
// 没有系统标题栏，但保留可以拖边缘改大小、Windows 的贴靠和圆角
const frameless = () => (MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { titleBarStyle: 'hidden' });
const bg = () => (cfg.dark ? '#16181d' : '#f7f7f5');

function offline(win, url) {
  const page = `<!doctype html><meta charset="utf-8"><title>Sealonote</title><body style="font:15px system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f6fa;color:#333;-webkit-app-region:drag"><div style="text-align:center"><p style="font-size:17px;font-weight:600">连不上 Sealonote</p><p style="color:#777">检查一下网络，连上以后点重试。</p><button onclick="location.href=${JSON.stringify(url || SITE + '/')}" style="-webkit-app-region:no-drag;font:inherit;padding:8px 18px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer">重试</button></div>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
}
function load(win, hash) {
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => { if (isMain && code !== -3) offline(win, url); });
  win.loadURL(SITE + '/' + (hash || ''));
}

/* ---------- 主窗口 ---------- */
function createMain() {
  const b = onScreen(cfg.main) ? cfg.main : { width: 1280, height: 820 };
  main = new BrowserWindow({ ...b, minWidth: 380, minHeight: 500, show: false, title: 'Sealonote', backgroundColor: bg(), icon: ICON, autoHideMenuBar: true, ...frameless(), webPreferences: webPrefs() });
  if (cfg.mainMax) main.maximize();
  trackBounds(main, ...keyed('main')); guard(main);
  main.on('maximize', () => { cfg.mainMax = true; saveCfg(); }); main.on('unmaximize', () => { cfg.mainMax = false; saveCfg(); });
  main.once('ready-to-show', () => main.show());
  // 关掉主窗口：还有便签 / 汤圆窗口开着就只是藏起来（托盘里能再打开）；都没开就退出（macOS 照惯例留在 Dock）
  main.on('close', (e) => {
    if (quitting) return;
    const others = [sticky, ai, ...notes.values()].some((w) => w && !w.isDestroyed() && w.isVisible());
    if (others || MAC) { e.preventDefault(); main.hide(); }
  });
  main.on('closed', () => { main = null; });
  load(main, '');
}
function showMain(hash) {
  if (!main || main.isDestroyed()) createMain();
  if (hash && /^#\//.test(hash)) main.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
  if (main.isMinimized()) main.restore();
  main.show(); main.focus(); if (vis(ai)) setTimeout(sideBySide, 50);
}

/* ---------- 便签 ---------- */
function defaultStickyBounds() { const w = screen.getPrimaryDisplay().workArea; return { width: 320, height: 480, x: w.x + w.width - 340, y: w.y + 40 }; }
function smallWin(bounds, extra = {}) {
  return new BrowserWindow({
    ...bounds, minWidth: 220, minHeight: 160, frame: false, show: false, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, backgroundColor: bg(), roundedCorners: true, hasShadow: true, icon: ICON, webPreferences: webPrefs(), ...extra,
  });
}
function createSticky() {
  sticky = smallWin(onScreen(cfg.sticky) ? cfg.sticky : defaultStickyBounds(), { title: '便签 · Sealonote', minWidth: 260, minHeight: 220 });
  if (cfg.stickyPin !== false) sticky.setAlwaysOnTop(true, 'floating');
  if (cfg.stickyOpacity) sticky.setOpacity(cfg.stickyOpacity);
  sticky.setVisibleOnAllWorkspaces(!!cfg.stickyAllSpaces, { visibleOnFullScreen: false });
  trackBounds(sticky, ...keyed('sticky')); guard(sticky);
  sticky.once('ready-to-show', () => { if (cfg.stickyOpen !== false) sticky.showInactive(); });
  sticky.on('close', (e) => { if (!quitting) { e.preventDefault(); hideSticky(); } });
  sticky.on('closed', () => { sticky = null; });
  load(sticky, '#/sticky');
}
function showSticky() {
  cfg.stickyOpen = true; saveCfg();
  if (!sticky || sticky.isDestroyed()) { createSticky(); return; }
  sticky.show(); sticky.focus(); refreshTray();
}
function hideSticky() { if (sticky && !sticky.isDestroyed()) sticky.hide(); cfg.stickyOpen = false; saveCfg(); refreshTray(); }

/* ---------- 单张便利贴 ---------- */
function showNote(id, at) {
  if (!/^[\w-]{1,64}$/.test(id)) return;
  const at2 = at && Number.isFinite(+at.x) && Number.isFinite(+at.y) ? { x: Math.round(+at.x), y: Math.round(+at.y) } : null;
  const old = notes.get(id); if (old && !old.isDestroyed()) { if (at2) old.setPosition(at2.x, at2.y); old.show(); old.focus(); return; }
  const n = cfg.notes[id] || {};
  const w = screen.getPrimaryDisplay().workArea; const k = notes.size;
  let b = onScreen(n.b) ? n.b : { width: 280, height: 300, x: w.x + w.width - 640 - k * 24, y: w.y + 60 + k * 24 };
  if (at2) b = { ...b, ...at2 };
  const win = smallWin(b, { title: '便利贴 · Sealonote', minWidth: 200, minHeight: 140 });
  if (n.pin !== false) win.setAlwaysOnTop(true, 'floating');
  if (n.op) win.setOpacity(n.op);
  trackBounds(win, () => (cfg.notes[id] || {}).b, (bb) => { cfg.notes[id] = { ...(cfg.notes[id] || {}), b: bb }; });
  guard(win);
  notes.set(id, win); cfg.notes[id] = { ...n, open: true }; saveCfg();
  win.once('ready-to-show', () => win.show());
  // 关掉这张：下次开机不再自动打开（位置大小还记着）
  win.on('close', () => { if (!quitting && cfg.notes[id]) { cfg.notes[id].open = false; saveCfg(); } });
  win.on('closed', () => { notes.delete(id); refreshTray(); });
  load(win, '#/sticky?note=' + id);
  refreshTray();
}
const noteOf = (e) => { for (const [id, w] of notes) if (w.webContents === e.sender) return id; return null; };

/* ---------- 汤圆窗口和主窗口并排，不叠在一起 ---------- */
// 打开汤圆时如果和主窗口叠着：汤圆靠到主窗口所在屏幕的右边，主窗口让出这块地方（最大化的先还原）。
// 关掉汤圆时，主窗口还是我们让出来的那个样子（你没再动过它），就还原回去。
let mainBefore = null, mainShrunk = null, notesMoved = [];
const vis = (w) => w && !w.isDestroyed() && w.isVisible() && !w.isMinimized();
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const same = (a, b) => b && ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 4); // 系统可能差一两像素
// 便签也让开：挡着汤圆的便签挪到汤圆左边一列；主窗口再让出这一列（让完还有 560 宽的话），变成「主窗口 | 便签 | 汤圆」
function sideBySide() {
  if (!vis(ai)) return;
  const GAP = 8; let A = ai.getBounds();
  const mainOn = vis(main) && !main.isFullScreen();
  const mb = mainOn && (main.isMaximized() ? screen.getDisplayMatching(main.getBounds()).workArea : main.getBounds());
  const wa = screen.getDisplayMatching(mainOn ? main.getBounds() : A).workArea;
  const aw = Math.min(Math.max(A.width, 380), 480, Math.floor(wa.width * .4));
  const dock = mainOn && overlap(mb, A) && wa.width - aw - GAP >= 560; // 屏幕太小，并排没法用，就不挪主窗口
  if (dock) { A = { x: wa.x + wa.width - aw, y: wa.y, width: aw, height: wa.height }; ai.setBounds(A); }
  // 便签
  let col = Infinity;
  for (const w of [sticky, ...notes.values()]) {
    if (!vis(w)) continue; const b = w.getBounds(); if (!overlap(b, A)) continue;
    const to = { x: Math.max(wa.x, A.x - GAP - b.width), y: Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height), width: b.width, height: b.height };
    if (!notesMoved.some((m) => m.w === w)) notesMoved.push({ w, before: b, to }); else notesMoved.find((m) => m.w === w).to = to;
    w.setBounds(to); col = Math.min(col, to.x);
  }
  if (!dock) return;
  mainBefore = mainBefore || { bounds: main.getNormalBounds ? main.getNormalBounds() : main.getBounds(), max: main.isMaximized() };
  if (main.isMaximized()) main.unmaximize();
  const x = Math.max(wa.x, Math.min(mb.x, A.x - GAP - 560));
  const right = col - GAP - x >= 560 ? col - GAP : A.x - GAP; // 让出便签那一列；让不出来就只让汤圆
  const nb = { x, y: mainBefore.max ? wa.y : Math.max(wa.y, mb.y), width: right - x, height: 0 };
  nb.height = mainBefore.max ? wa.height : Math.min(mb.height, wa.y + wa.height - nb.y);
  main.setBounds(nb); mainShrunk = nb; // 记要求的大小：系统可能稍后才真正改好
}
// 关掉汤圆：主窗口、便签回到原来的样子；中途你自己挪过、调过的就不管
function restoreMain() {
  for (const m of notesMoved) if (m.w && !m.w.isDestroyed() && same(m.w.getBounds(), m.to)) m.w.setBounds(m.before);
  notesMoved = [];
  const before = mainBefore; mainBefore = null; if (!before || !main || main.isDestroyed()) return;
  if (!same(main.getBounds(), mainShrunk)) return;
  main.setBounds(before.bounds); if (before.max) main.maximize();
}
/* ---------- 汤圆（AI 对话）---------- */
function showAI() {
  if (ai && !ai.isDestroyed()) { if (ai.isMinimized()) ai.restore(); ai.show(); ai.focus(); sideBySide(); return; }
  const w = screen.getPrimaryDisplay().workArea;
  const b = onScreen(cfg.ai) ? cfg.ai : { width: 560, height: Math.min(780, w.height - 80), x: w.x + Math.round((w.width - 560) / 2), y: w.y + 40 };
  ai = new BrowserWindow({ ...b, minWidth: 380, minHeight: 420, show: false, title: '汤圆 · Sealonote', backgroundColor: bg(), icon: ICON, autoHideMenuBar: true, ...frameless(), webPreferences: webPrefs() });
  if (cfg.aiPin) ai.setAlwaysOnTop(true, 'floating');
  trackBounds(ai, ...keyed('ai')); guard(ai);
  ai.once('ready-to-show', () => { ai.show(); sideBySide(); });
  ai.on('close', (e) => { if (!quitting) { e.preventDefault(); ai.hide(); restoreMain(); refreshTray(); } });
  ai.on('closed', () => { ai = null; });
  load(ai, '#/seal');
  refreshTray();
}

/* ---------- 桌面汤圆 ---------- */
const PET_W = 220, PET_H = 300;
function defaultPetPos() { const w = screen.getPrimaryDisplay().workArea; return { x: w.x + w.width - PET_W - 24, y: w.y + w.height - PET_H - 8 }; }
function createPet() {
  const at = cfg.pet && onScreen({ ...cfg.pet, width: PET_W, height: PET_H }) ? cfg.pet : defaultPetPos();
  const k = petScale(); const [pw, ph] = petDims(k); pet = new BrowserWindow({ x: at.x, y: at.y, width: pw, height: ph, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, show: false, title: '汤圆', icon: ICON, webPreferences: { ...webPrefs(), backgroundThrottling: false, zoomFactor: k } });
  pet.setAlwaysOnTop(true, 'floating'); pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 不再用「点击穿透」：Windows 上它要装一个全局鼠标钩子，主进程一忙整台电脑的鼠标都会卡。改成窗口只有汤圆那么大（网页量好尺寸告诉这里）
  guard(pet);
  pet.once('ready-to-show', () => { pet.webContents.setZoomFactor(petScale()); pet.showInactive(); });
  pet.on('close', (e) => { if (!quitting) { e.preventDefault(); hidePet(); } });
  pet.on('closed', () => { pet = null; });
  load(pet, '#/pet');
  startKeys();
}
const petScale = () => Math.max(.6, Math.min(1.8, Number(cfg.petScale) || 1));
// 变大变小：窗口跟着缩放，汤圆脚下那一点不动（底边中间对齐）
const ROOM_W = 380, ROOM_H = 400;
const petDims = (k = petScale()) => (cfg.petRoom ? [ROOM_W, ROOM_H] : cfg.petFit ? cfg.petFit : [PET_W, PET_H]).map((v) => Math.round(v * k));
// 打开 / 关上房间：窗口变大变小，脚下那一点不动
function setPetRoom(on) {
  cfg.petRoom = !!on; saveCfg(); if (!pet || pet.isDestroyed()) return cfg.petRoom;
  const b = pet.getBounds(); const [w, h] = petDims(); const x = Math.round(b.x + b.width / 2 - w / 2), y = b.y + b.height - h;
  pet.setBounds({ x, y, width: w, height: h }); cfg.pet = { x, y }; saveCfg(); keepPetOnScreen(); return cfg.petRoom;
}
// 网页量好内容的大小（CSS 像素）：窗口刚好这么大，底边中间不动——没有透明的空白挡着后面的东西
function fitPet(w, h) {
  w = Math.max(80, Math.min(600, Math.round(w))); h = Math.max(80, Math.min(700, Math.round(h)));
  if (!cfg.petRoom) { cfg.petFit = [w, h]; saveCfg(); }
  if (!pet || pet.isDestroyed() || cfg.petRoom || dragT) return;
  const k = petScale(); const b = pet.getBounds(); const W = Math.round(w * k), H = Math.round(h * k);
  if (Math.abs(W - b.width) < 2 && Math.abs(H - b.height) < 2) return;
  const x = Math.round(b.x + b.width / 2 - W / 2), y = b.y + b.height - H;
  pet.setBounds({ x, y, width: W, height: H }); cfg.pet = { x, y }; saveCfg(); keepPetOnScreen();
}
// 拖动：按下以后由这里跟着鼠标挪窗口（每秒 60 次），不用网页每动一下发一次消息
let dragT = null;
function petDragStart(ox, oy) {
  if (!pet || pet.isDestroyed()) return; clearInterval(dragT);
  const t0 = Date.now(); // 万一松手的消息没到（网页卡住、崩了），30 秒后自己停，不会一直跟着鼠标
  dragT = setInterval(() => { if (!pet || pet.isDestroyed() || Date.now() - t0 > 30e3) { petDragEnd(); return; } const c = screen.getCursorScreenPoint(); const [x, y] = pet.getPosition(); const nx = Math.round(c.x - ox), ny = Math.round(c.y - oy); if (nx !== x || ny !== y) pet.setPosition(nx, ny); }, 16);
}
function petDragEnd() { clearInterval(dragT); dragT = null; if (pet && !pet.isDestroyed()) { const [x, y] = pet.getPosition(); cfg.pet = { x, y }; saveCfg(); keepPetOnScreen(); } }
function setPetScale(k) {
  k = Math.max(.6, Math.min(1.8, Number(k) || 1)); cfg.petScale = k; saveCfg();
  if (!pet || pet.isDestroyed()) return k;
  const b = pet.getBounds(); const [w, h] = petDims(k);
  const x = Math.round(b.x + b.width / 2 - w / 2), y = b.y + b.height - h;
  pet.setBounds({ x, y, width: w, height: h }); pet.webContents.setZoomFactor(k); cfg.pet = { x, y }; saveCfg(); keepPetOnScreen();
  return k;
}
function showPet() { cfg.petOn = true; saveCfg(); if (!pet || pet.isDestroyed()) createPet(); else pet.showInactive(); refreshTray(); }
function hidePet() { if (pet && !pet.isDestroyed()) pet.hide(); cfg.petOn = false; saveCfg(); refreshTray(); }

// 数按键：只在这里加一，按的是哪个键不存、不传。按住不放（自动重复）只算一下
const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let worker = null, keysErr = '';
function keyStats() { const k = cfg.keys || {}; const today = k[day()] || 0; const total = Object.values(k).reduce((a, b) => a + b, 0); return { today, total, on: cfg.countKeys !== false, running: !!worker, needsPermission: MAC && !systemPreferences.isTrustedAccessibilityClient(false), error: keysErr, wayland: WAYLAND }; }
function addKeys(n) {
  cfg.keys = cfg.keys || {}; const d = day(); cfg.keys[d] = (cfg.keys[d] || 0) + n;
  const ks = Object.keys(cfg.keys); if (ks.length > 400) cfg.keys = Object.fromEntries(ks.sort().slice(-400).map((k) => [k, cfg.keys[k]]));
  saveCfg();
  if (pet && !pet.isDestroyed()) pet.webContents.send('pet:key', { today: cfg.keys[d], n });
}
// 键盘钩子放在单独的后台进程里（keys-worker.js），只把「这一小段按了几下」发过来。
// 意外退出会自己重启（1 分钟里最多 3 次，再多说明真有问题，就停下来、在菜单里说明）；睡醒 / 解锁后也重启一次，
// 因为有的系统睡眠后键盘钩子就收不到东西了（BongoCat 也遇到过）。
const WAYLAND = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
let restarts = [];
function startKeys() {
  if (worker || cfg.countKeys === false) return;
  if (WAYLAND) { keysErr = 'wayland'; return; } // Wayland 不允许程序读全局键盘
  if (MAC && !systemPreferences.isTrustedAccessibilityClient(false)) { keysErr = 'needs-permission'; return; } // macOS 要先在「辅助功能」里允许
  try {
    const w = utilityProcess.fork(path.join(__dirname, 'keys-worker.js'), [], { serviceName: 'SealoNote key counter' }); worker = w; w.stopping = false;
    w.on('message', (m) => { if (m && m.n) addKeys(m.n); else if (m && m.error) { keysErr = m.error; stopKeys(); } else if (m && m.ok) keysErr = ''; });
    w.on('exit', () => {
      if (worker === w) worker = null;
      if (w.stopping || cfg.countKeys === false || quitting) return;
      const now = Date.now(); restarts = restarts.filter((t) => now - t < 60e3);
      if (restarts.length >= 3) { keysErr = 'crashed'; return; }
      restarts.push(now); setTimeout(startKeys, 1000);
    });
  } catch (err) { worker = null; keysErr = String((err && err.message) || err); }
}
function stopKeys() { const w = worker; worker = null; if (!w) return; w.stopping = true; try { w.postMessage('stop'); } catch {} setTimeout(() => { try { w.kill(); } catch {} }, 500); }
function restartKeys() { if (cfg.countKeys === false) return; stopKeys(); setTimeout(startKeys, 800); }
function resetKeys() { try { worker && worker.postMessage('reset'); } catch {} }

// 汤圆别跑到屏幕外面去：拔了外接屏、改了分辨率、拖出去、变大以后，都拉回最近的屏幕里
function keepPetOnScreen() {
  if (!pet || pet.isDestroyed()) return;
  const b = pet.getBounds(); const wa = screen.getDisplayMatching(b).workArea;
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - b.width), y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
  if (x !== b.x || y !== b.y) { pet.setPosition(x, y); cfg.pet = { x, y }; saveCfg(); }
}

function setPin(win, on) { if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!on, 'floating'); }

function refreshTray() {
  if (!tray) return;
  const stickyShown = !!(sticky && !sticky.isDestroyed() && sticky.isVisible());
  const login = app.getLoginItemSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Sealonote', click: () => showMain() },
    { label: '汤圆（AI 对话）', click: () => showAI() },
    { label: stickyShown ? '收起便签' : '显示便签', click: () => (stickyShown ? hideSticky() : showSticky()) },
    { label: '桌面汤圆', type: 'checkbox', checked: !!(pet && !pet.isDestroyed() && pet.isVisible()), click: (i) => (i.checked ? showPet() : hidePet()) },
    { label: '便签置顶', type: 'checkbox', checked: cfg.stickyPin !== false, click: (i) => { cfg.stickyPin = i.checked; saveCfg(); setPin(sticky, i.checked); } },
    ...(MAC ? [{ label: '便签在所有桌面上都显示', type: 'checkbox', checked: !!cfg.stickyAllSpaces, click: (i) => { cfg.stickyAllSpaces = i.checked; saveCfg(); if (sticky && !sticky.isDestroyed()) sticky.setVisibleOnAllWorkspaces(i.checked); } }] : []),
    { type: 'separator' },
    { label: '开机时启动（只开便签）', type: 'checkbox', checked: !!login.openAtLogin, click: (i) => { app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--sticky-only'] }); refreshTray(); } },
    { label: '刷新', click: () => { [main, sticky, ai, pet, ...notes.values()].forEach((w) => w && !w.isDestroyed() && w.webContents.reload()); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: MAC ? 18 : 16, quality: 'best' }));
  tray.setToolTip('Sealonote');
  tray.on('click', () => { if (!MAC) showMain(); });
  refreshTray();
}

function appMenu() {
  if (!MAC) { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新' }, { role: 'togglefullscreen', label: '全屏' }, { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '实际大小' }] },
    { label: '窗口', submenu: [{ label: '汤圆（AI 对话）', accelerator: 'CmdOrCtrl+Shift+Y', click: () => showAI() }, { label: '显示 / 收起便签', accelerator: 'CmdOrCtrl+Shift+J', click: () => (sticky && sticky.isVisible() ? hideSticky() : showSticky()) }, { type: 'separator' }, { role: 'minimize' }, { role: 'close' }] },
  ]));
}

// ---- 启动 ----
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(() => {
    loadCfg();
    // Google 不让带「Electron」字样的浏览器登录：用和 Chrome 一样的 UA
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(ses.getUserAgent().replace(/\s*Electron\/[\d.]+/, '').replace(/\s*sealonote-desktop\/[\d.]+/, ''));
    // 网站要麦克风（语音输入）就给；别的权限一律不给
    ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(isAppUrl(details.requestingUrl || wc.getURL()) && ['media', 'clipboard-sanitized-write', 'notifications', 'fullscreen'].includes(perm)));

    const winOf = (e) => BrowserWindow.fromWebContents(e.sender);
    // 网页自己画的窗口按钮
    ipcMain.handle('win:min', (e) => { const w = winOf(e); if (w) w.minimize(); });
    ipcMain.handle('win:max', (e) => { const w = winOf(e); if (!w) return false; if (w.isMaximized()) w.unmaximize(); else w.maximize(); return w.isMaximized(); });
    ipcMain.handle('win:close', (e) => { const w = winOf(e); if (w) w.close(); });
    ipcMain.handle('win:isMax', (e) => { const w = winOf(e); return !!(w && w.isMaximized()); });
    ipcMain.handle('win:theme', (_e, dark) => { if (cfg.dark !== !!dark) { cfg.dark = !!dark; saveCfg(); } });
    // 便签窗口 / 单张便利贴：置顶、透明度（各窗口各记各的）
    ipcMain.handle('sticky:show', () => { showSticky(); });
    ipcMain.handle('sticky:hide', () => { hideSticky(); });
    ipcMain.handle('sticky:getPin', (e) => { const id = noteOf(e); return id ? (cfg.notes[id] || {}).pin !== false : cfg.stickyPin !== false; });
    ipcMain.handle('sticky:setPin', (e, on) => { const id = noteOf(e); if (id) { cfg.notes[id] = { ...(cfg.notes[id] || {}), pin: !!on }; } else cfg.stickyPin = !!on; saveCfg(); setPin(winOf(e), on); refreshTray(); return !!on; });
    ipcMain.handle('sticky:getOpacity', (e) => { const id = noteOf(e); return (id ? (cfg.notes[id] || {}).op : cfg.stickyOpacity) || 1; });
    ipcMain.handle('sticky:setOpacity', (e, v) => { const o = Math.max(0.3, Math.min(1, Number(v) || 1)); const id = noteOf(e); if (id) cfg.notes[id] = { ...(cfg.notes[id] || {}), op: o }; else cfg.stickyOpacity = o; saveCfg(); const w = winOf(e); if (w) w.setOpacity(o); return o; });
    ipcMain.handle('note:pop', (_e, id, at) => { showNote(String(id || ''), at); });
    ipcMain.handle('ai:show', () => { showAI(); });
    ipcMain.handle('ai:getPin', () => !!cfg.aiPin);
    ipcMain.handle('ai:setPin', (_e, on) => { cfg.aiPin = !!on; saveCfg(); setPin(ai, on); return !!on; });
    ipcMain.handle('main:open', (_e, hash) => { showMain(typeof hash === 'string' ? hash : ''); });
    ipcMain.handle('pet:show', () => { showPet(); });
    ipcMain.handle('pet:hide', () => { hidePet(); });
    ipcMain.on('pet:moveBy', (_e, dx, dy) => { if (!pet || pet.isDestroyed()) return; const [x, y] = pet.getPosition(); const nx = x + (dx | 0), ny = y + (dy | 0); pet.setPosition(nx, ny); cfg.pet = { x: nx, y: ny }; saveCfg(); });
    ipcMain.handle('pet:stats', () => keyStats());
    ipcMain.handle('pet:setScale', (_e, k) => setPetScale(k));
    ipcMain.handle('pet:setRoom', (_e, on) => setPetRoom(on));
    ipcMain.on('pet:hit', () => {}); // 0.6.3 的网页还会调；现在不穿透了
    ipcMain.on('pet:fit', (_e, w, h) => fitPet(Number(w), Number(h)));
    ipcMain.on('pet:dragStart', (_e, ox, oy) => petDragStart(Number(ox) || 0, Number(oy) || 0));
    ipcMain.on('pet:dragEnd', () => petDragEnd());
    ipcMain.handle('pet:setCount', (_e, on) => { cfg.countKeys = !!on; saveCfg(); if (on) { if (MAC && !systemPreferences.isTrustedAccessibilityClient(true)) { keysErr = 'needs-permission'; return keyStats(); } startKeys(); } else stopKeys(); return keyStats(); });
    ipcMain.handle('titlebar:set', () => {}); // 0.2 的网页还会调；现在按钮由网页自己画

    appMenu(); createTray();
    const stickyOnly = process.argv.includes('--sticky-only') || app.getLoginItemSettings().wasOpenedAtLogin;
    if (!stickyOnly) createMain();
    if (stickyOnly || cfg.stickyOpen !== false) createSticky();
    if (stickyOnly && cfg.stickyOpen === false) showSticky();
    if (cfg.petOn !== false) createPet(); // 桌面汤圆默认开着，托盘里可以关
    // 锁屏 / 睡眠：按着的键的状态清掉（keyup 会丢）；睡醒 / 解锁：键盘计数重启一下
    powerMonitor.on('suspend', resetKeys); powerMonitor.on('lock-screen', resetKeys);
    powerMonitor.on('resume', restartKeys); powerMonitor.on('unlock-screen', restartKeys);
    // 屏幕变了（拔外接屏、改分辨率 / 缩放）：汤圆拉回屏幕里
    ['display-removed', 'display-added', 'display-metrics-changed'].forEach((ev) => screen.on(ev, () => setTimeout(keepPetOnScreen, 300)));
    // macOS：「辅助功能」权限中途被关掉 / 打开，每 30 秒看一次，跟着停 / 开
    if (MAC) setInterval(() => { const ok = systemPreferences.isTrustedAccessibilityClient(false); if (!ok && worker) { stopKeys(); keysErr = 'needs-permission'; } else if (ok && !worker && cfg.countKeys !== false && keysErr === 'needs-permission') { keysErr = ''; startKeys(); } }, 30e3);
    Object.entries(cfg.notes).forEach(([id, n]) => { if (n && n.open) showNote(id); });
  });
  app.on('activate', () => showMain());
  app.on('before-quit', () => { quitting = true; stopKeys(); clearTimeout(saveT); writeCfgNow(); });
  app.on('window-all-closed', () => { if (!MAC) app.quit(); });
}
