import { html, render, useEffect, useState, useMemo, useRef } from '../vendor/preact.js';
import { useStore, update, get } from './store.js';
import { Icon, IconBtn, Modal } from './ui.js';
import { todayStr, weekKey, setExtraKinds , setTagOverrides } from './util.js';
import { seedIfEmpty } from './seed.js';
import Dashboard from './views/dashboard.js';
import TodayView from './views/today.js';
import Todos from './views/todos.js';
import Planner from './views/planner.js';
import Reading from './views/reading.js';
import Links from './views/links.js';
import Notes from './views/notes.js';
import Vision from './views/vision.js';
import Explore from './views/explore.js';
import Settings from './views/settings.js';
import Focus, { MiniPomo } from './views/focus.js';
import Brain from './views/brain.js';
import Money from './views/money.js';
import Sticky, { keepSticky, popSticky, StickiesPage } from './views/sticky.js';
import Pet from './views/pet.js';
import { WinControls, initDesktop } from './winctl.js';
import { initI18n, getLang, setLang } from './i18n.js';
import { CountdownPage } from './views/countdown.js';
import { dueSoon, remindDue } from './money.js';
import { unsortedCount } from './brain.js';
import { SearchPalette, setSearchRoutes } from './search.js';
import { PageTree, useTreeState, newNote, newNotebook, ancestors, noteTitle, notebookMenu, movePage } from './views/notes.js';
import { dragProps, dropProps } from './dnd.js';
import { go, toast } from './nav.js';
import { initLiquid } from './liquid.js';
import { ctxMenu } from './ctx.js';
import { askPrompt } from './confirm.js';
import { Splitter, applySizes } from './resize.js';
import { detectLogin, autoSync, loginState, loggedIn, smartSync, guarded, status as syncStatus } from './sync.js';
import { injectFontCss } from './fonts.js';
import { initGameFx } from './gamefx.js';
injectFontCss();
import { subscribe } from './store.js';
export { go, toast };

import { Capture } from './capture.js';
import { Seal } from './seal.js';
import { dueCount } from './review.js';

// 侧栏「今天」的数字：今天还没做完的待办
const todayLeft = (s) => { const d = new Date(); const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return s.todos.filter((x) => !x.done && x.due && x.due <= t && (x.dueEnd || x.due) >= t).length; };
export const ROUTES = [
  { path: 'home', name: '总览', icon: 'home', view: Dashboard },
  { sep: '每一天' },
  { path: 'todos', name: '待办', icon: 'checksq', view: Todos, count: (s) => s.todos.filter((t) => !t.done).length },
  { path: 'brain', name: '大脑', icon: 'brain', view: Brain, count: unsortedCount, show: (s) => s.settings.brainNav !== false },
  { path: 'today', name: '今天', icon: 'sun', view: TodayView, count: todayLeft },
  { path: 'plan', name: '计划', icon: 'calendar', view: Planner },
  { path: 'focus', name: '专注', icon: 'clock', view: Focus },
  { path: 'stickies', name: '便签', icon: 'tack', view: StickiesPage, show: (s) => s.settings.stickyNav !== false },
  { path: 'countdown', name: '倒计时', icon: 'clock', view: CountdownPage, show: (s) => s.settings.cdNav !== false },
  { path: 'money', name: '钱包', icon: 'wallet', view: Money, count: (s) => dueSoon(s).length },
  { sep: '输入与输出' },
  { path: 'reading', name: '阅读', icon: 'book', view: Reading, count: (s) => s.books.filter((b) => b.status === 'reading').length },
  { path: 'links', name: '收藏', icon: 'link', view: Links },
  { path: 'notes', name: '笔记', icon: 'note', view: Notes, match: (r) => r.path === 'notes' && !(r.sub || '').startsWith('canvas'), count: (s) => dueCount(s.notes) },
  { path: 'notes', href: 'notes/canvas', name: '画布', icon: 'frame', match: (r) => r.path === 'notes' && (r.sub || '').startsWith('canvas') },
  { sep: '远方' },
  { path: 'vision', name: '愿景', icon: 'sparkle', view: Vision },
  { path: 'explore', name: '探索', icon: 'globe', view: Explore },
  { path: 'settings', name: '设置', icon: 'settings', view: Settings, hidden: true },
];

// 侧栏顺序：settings.navOrder 记的是一串 key（分组标题是 'sep:名字'），拖动后存下来；新加的入口按默认位置插回去
const navKey = (r) => (r.sep !== undefined ? 'sep:' + r.sep : r.href || r.path);
function orderedRoutes(saved) {
  if (!Array.isArray(saved) || !saved.length) return ROUTES;
  const byKey = new Map(ROUTES.map((r) => [navKey(r), r]));
  const out = saved.map((k) => byKey.get(k)).filter(Boolean); const have = new Set(out);
  ROUTES.forEach((r, i) => { if (have.has(r)) return; const prev = ROUTES.slice(0, i).reverse().find((x) => have.has(x)); out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, r); have.add(r); });
  return out;
}
function moveNav(list, from, to, after) {
  const keys = list.map(navKey); const i = keys.indexOf(from); if (i < 0 || from === to) return;
  keys.splice(i, 1); let j = keys.indexOf(to); if (j < 0) return; if (after) j++; keys.splice(j, 0, from);
  update((d) => { d.settings.navOrder = keys; });
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [h, q] = raw.split('?');
  const [path, ...rest] = h.split('/');
  return { path: path || 'home', sub: rest.join('/') || '', query: Object.fromEntries(new URLSearchParams(q || '')) };
}

// 手机「更多」：照「iOS 26 手机端 · ④ 更多」——半屏玻璃面板，彩色图标宫格 + 外观 / 完整导航 / 帐号
const MORE_TILES = [['plan', '计划', 'calendar', '#E5EDFF', '#2B63E8'], ['focus', '专注', 'clock', '#FFEEDD', '#B95F0A'], ['reading', '阅读', 'book', '#E2F5E9', '#1E7A45'], ['links', '收藏', 'bookmark', '#FCE7F0', '#B4306A'],
  ['notes/canvas', '画布', 'frame', '#EEE8FD', '#6A3FD1'], ['vision', '愿景', 'sparkle', '#FFF4D6', '#946200'], ['explore', '探索', 'compass', '#DFF3F4', '#12707A'], ['brain', '大脑', 'brain', '#FDE8E8', '#B83A3A'],
  ['stickies', '便签', 'tack', '#FFF4D6', '#8A6A00'], ['countdown', '倒计时', 'target', '#E8F0FB', '#2B5DAA'], ['money', '钱包', 'wallet', '#E6F4EA', '#2E7D4F'], ['settings', '设置', 'settings', '#ECECF0', '#4A4A52']];
function MoreSheet({ s, onClose, openNav }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const badge = { reading: s.books.filter((b) => b.status === 'reading').length, brain: unsortedCount(s), money: dueSoon(s).length };
  const theme = s.settings.theme || 'auto';
  return html`<div class="more-sheet-wrap" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section class="more-sheet" aria-label="更多" role="dialog">
      <i class="ms-grab" aria-hidden="true"></i>
      <div class="ms-h"><h2>更多</h2><button type="button" class="ms-x" aria-label="关闭" onClick=${onClose}><${Icon} name="x" size=${16} /></button></div>
      <div class="ms-grid">${MORE_TILES.map(([h, n, ic, bg, fg]) => html`<a key=${h} href=${'#/' + h} onClick=${onClose}><span class="ms-ic" style=${`background:${bg};color:${fg}`}><${Icon} name=${ic} size=${26} /></span><span>${n}</span>${badge[h] > 0 && html`<b class="ms-badge">${badge[h]}</b>`}</a>`)}</div>
      <div class="ms-list">
        <div class="ms-row"><${Icon} name="moon" size=${20} /><span class="flex1">外观</span><div class="ms-seg" role="radiogroup" aria-label="外观">${[['light', '浅色'], ['dark', '深色'], ['auto', '自动']].map(([v, l]) => html`<button type="button" role="radio" aria-checked=${theme === v} class=${theme === v ? 'on' : ''} onClick=${() => update((d) => { d.settings.theme = v; })}>${l}</button>`)}</div></div>
        <button type="button" class="ms-row" onClick=${openNav}><${Icon} name="sidebar" size=${20} /><span class="flex1">完整导航</span><small>笔记本 · 页面</small><${Icon} name="right" size=${14} /></button>
        <a class="ms-row ms-me" href="#/settings" onClick=${onClose}><span class="ms-av">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || 'R')[0]}</span><span class="flex1"><b>${s.profile.name}</b><small>${s.settings.lastSync ? '已同步' : '本地存储'} · 头像与帐号</small></span><${Icon} name="right" size=${14} /></a>
      </div>
    </section>
  </div>`;
}

// 这台设备没在同步时提醒一句：没登录，或者登录了但超过一天没同步上。
// 不然 Claude（MCP）和别的设备写进来的东西在这台上看不到，看起来像「丢了」。关掉后 3 天内不再提醒。
function SyncNudge({ s }) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((x) => x + 1); window.addEventListener('ytos:login', f); syncStatus.listeners.add(f); const t = setTimeout(f, 8000); return () => { window.removeEventListener('ytos:login', f); syncStatus.listeners.delete(f); clearTimeout(t); }; }, []);
  const KEY = 'ytos.syncnudge.off'; let off = 0; try { off = Number(localStorage.getItem(KEY) || 0); } catch {}
  if (Date.now() < off) return null;
  const api = loginState(); if (!api || !api.configured) return null; // 本地版 / 没有云端的地方不提醒
  const close = () => { try { localStorage.setItem(KEY, String(Date.now() + 3 * 864e5)); } catch {} tick((x) => x + 1); };
  let msg = '', act = null;
  if (!loggedIn()) { msg = '这台设备没有登录同步：Claude 和其他设备写进来的内容在这里看不到。'; act = html`<a class="sn-btn" href="#/settings?sec=account">去登录</a>`; }
  else {
    const last = s.settings.lastSync ? Date.parse(s.settings.lastSync) : 0; const age = Date.now() - last;
    if (syncStatus.busy || age < 864e5) return null;
    if (!last && performance.now() < 15000) return null; // 刚打开，第一次同步还在路上
    const days = Math.max(1, Math.floor(age / 864e5));
    msg = last ? `这台设备 ${days} 天没同步了${syncStatus.error ? '（' + syncStatus.error.slice(0, 40) + '）' : ''}，可能缺了别处写进来的内容。` : '这台设备还没同步过。';
    act = html`<button type="button" class="sn-btn" onClick=${() => guarded(() => smartSync()).catch(() => {})}>立即同步</button>`;
  }
  return html`<div class="sync-nudge" role="status"><${Icon} name="cloud" size=${15} /><span class="flex1">${msg}</span>${act}<button type="button" class="sn-x" aria-label="关闭提醒" title="3 天内不再提醒" onClick=${close}><${Icon} name="x" size=${13} /></button></div>`;
}

export function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const h = () => setR(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export // 先下线的风格：样式还在，选择器里不显示，已选的人退回「玻璃」
const HIDDEN_SKINS = new Set(['liquid', 'mac']);
function applyTheme(t, skin, fx, glow, accent) {
  const real = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  document.documentElement.dataset.theme = real;
  // 质感：lite 不给卡片和侧栏加毛玻璃（backdrop-filter 很吃 GPU，鼠标一动就重算，是卡顿的主因）；full 才开
  if (fx !== undefined) document.documentElement.dataset.fx = fx === 'full' ? 'full' : 'lite';
  if (glow !== undefined) document.documentElement.dataset.glow = glow === false ? '0' : '1';
  if (accent !== undefined) document.documentElement.dataset.accent = accent || 'none';
  // 搁浅、方舟用的窄体字：选了这两个风格才去加载
  if ((skin === 'strand' || skin === 'ark') && !document.getElementById('font-strand')) { const l = document.createElement('link'); l.id = 'font-strand'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&display=swap'; document.head.appendChild(l); }
  if (skin !== undefined) document.documentElement.dataset.skin = HIDDEN_SKINS.has(skin) ? 'glass' : (skin === 'win95' ? 'xp' : skin) || 'notion';
}

function App() {
  const s = useStore();
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false); // 手机「更多」半屏面板
  const [cap, setCap] = useState(false);
  const [search, setSearch] = useState(false);
  // 「记一下」并入汤圆：有汤圆就打开对话框，隐藏了汤圆才用本地规则的随手记
  const sealOn = useRef(true); sealOn.current = s.settings.seal !== false;
  const capture = () => { if (sealOn.current) window.dispatchEvent(new CustomEvent('seal:ask')); else setCap((v) => !v); };
  const tree = useTreeState();
  const [navOpen, setNavOpen] = useState(() => { try { return { notes: true, ...JSON.parse(localStorage.getItem('ytos.nav') || '{}') }; } catch { return { notes: true }; } });
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('ytos.side') === 'mini'; } catch { return false; } });
  const toggleMini = () => { if (matchMedia('(max-width:900px)').matches) { setMenu(false); return; } setMini((m) => { try { localStorage.setItem('ytos.side', m ? 'full' : 'mini'); } catch {} return !m; }); };
  const toggleNav = (k) => setNavOpen((o) => { const n = { ...o, [k]: o[k] === false }; try { localStorage.setItem('ytos.nav', JSON.stringify(n)); } catch {} return n; });
  const nbOpen = (id) => navOpen['nb:' + id] !== false; // 默认全部展开；你收起过的记住（ytos.nav）
  const toggleNb = (id) => setNavOpen((o) => { const n = { ...o, ['nb:' + id]: !nbOpen(id) }; try { localStorage.setItem('ytos.nav', JSON.stringify(n)); } catch {} return n; });
  const nbHas = (id) => s.notes.some((n) => n.nb === id);
  const curNote = route.path === 'notes' ? s.notes.find((n) => n.id === route.sub) : null;
  const curNoteNb = curNote && curNote.nb;
  const active = ROUTES.find((r) => r.path === route.path && r.view) || ROUTES[0];
  const View = active.view;

  useEffect(() => {
    applyTheme(s.settings.theme, s.settings.skin || 'notion', s.settings.fx || 'lite', s.settings.sealGlow !== false, s.settings.sealAccent || 'none');
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => s.settings.theme === 'auto' && applyTheme('auto');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [s.settings.theme, s.settings.skin, s.settings.fx]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); capture(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    setMenu(false);
    window.scrollTo({ top: 0 });
    document.title = `${active.name} · SealoNote`;
  }, [route.path, route.sub]);

  const toggleTheme = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    update((d) => { d.settings.theme = next; });
  };

  return html`<div class=${'shell ' + (mini ? 'shell-mini' : '')}>
    ${menu && html`<div class="side-bg" onClick=${() => setMenu(false)}></div>`}
    <aside class=${'side ' + (menu ? 'open ' : '') + (mini ? 'mini' : '')}>
      <div class="side-top">
        <span class="side-week">${weekKey(todayStr())}</span>
        <button class="ibtn side-tg" title=${mini ? '展开侧栏' : '收起侧栏'} onClick=${toggleMini}><${Icon} name=${mini ? 'right' : 'left'} size=${14} /></button>
      </div>
      <nav class="nav" data-liquid=".nav > a, .pt-row"><span class="liq"></span>
        ${(() => { let section = ''; const list = orderedRoutes(s.settings.navOrder); const navDrop = (k) => dropProps('nav', (d, { after }) => moveNav(list, d.key, k, after), { position: true }); return list.map((r) => {
          if (r.sep !== undefined) { section = r.sep; return r.sep ? html`<button class=${'sep ' + (navOpen['s:' + r.sep] === false ? 'closed' : '')} onClick=${() => toggleNav('s:' + r.sep)} ...${navDrop(navKey(r))}><span>${r.sep}</span><${Icon} name="down" size=${11} /></button>` : html`<div class="sep"></div>`; }
          if (r.hidden || (r.show && !r.show(s))) return null;
          if (section && navOpen['s:' + section] === false && !mini) return null;
          const isActive = r.match ? r.match(route) : route.path === r.path;
          return html`<a href=${'#/' + (r.href || r.path)} class=${isActive ? 'active' : ''} data-tip=${r.name} ...${dragProps('nav', { key: navKey(r), id: navKey(r) })} ...${navDrop(navKey(r))} onContextMenu=${(e) => ctxMenu(e, [{ label: '在新标签页打开', icon: 'external', onClick: () => window.open('#/' + r.path, '_blank') }, { label: mini ? '展开侧栏' : '收起侧栏', icon: mini ? 'right' : 'left', onClick: toggleMini }, r.path === 'notes' && r.view && { label: navOpen.notes ? '收起页面树' : '展开页面树', icon: 'layers', onClick: () => toggleNav('notes') }, 'sep', { label: '拖动可以调整顺序', icon: 'cursor', disabled: true }, s.settings.navOrder && { label: '恢复默认顺序', icon: 'refresh', onClick: () => update((d) => { delete d.settings.navOrder; }) }], r.name)}><${Icon} name=${r.icon} size=${16} /><span class="nl">${r.name}</span>${r.count && r.count(s) > 0 && html`<span class="cnt">${r.count(s)}</span>`}${r.path === 'notes' && r.view && html`<button class="nav-tg" title=${navOpen.notes ? '收起页面' : '展开页面'} onClick=${(e) => { e.preventDefault(); toggleNav('notes'); }}><${Icon} name="right" size=${12} class=${navOpen.notes ? 'rot' : ''} /></button>`}</a>
            ${r.path === 'notes' && r.view && navOpen.notes && !mini && html`<div class="nav-tree tree-in">
              ${[...s.notebooks].sort((a, b) => a.order - b.order).map((b) => html`<div key=${b.id}>
                <div class=${'pt-row nb-row ' + (!nbOpen(b.id) ? 'closed' : '')} ...${dragProps('notebook', { id: b.id })} ...${dropProps(['page', 'notebook'], (d, { after }) => { if (d.id === b.id) return; if (s.notes.some((n) => n.id === d.id)) movePage(d.id, { nb: b.id, parent: null }); else update((dd) => { const list = dd.notebooks.sort((x, y) => x.order - y.order); const from = list.findIndex((x) => x.id === d.id); const [mv] = list.splice(from, 1); let to = list.findIndex((x) => x.id === b.id); if (after) to++; list.splice(to, 0, mv); list.forEach((x, i) => { x.order = i; }); }); }, { position: true })} onContextMenu=${(e) => ctxMenu(e, notebookMenu(b, s, async () => { const v = await askPrompt('本子名称', b.name, { title: '重命名本子' }); if (v && v.trim()) update((d) => { d.notebooks.find((x) => x.id === b.id).name = v.trim(); }); }), b.name)}>
                  <button class=${'pt-tg ' + (nbOpen(b.id) ? 'open ' : '') + (nbHas(b.id) ? '' : 'none')} title=${nbOpen(b.id) ? '收起' : '展开'} aria-expanded=${String(nbOpen(b.id))} onClick=${(e) => { e.stopPropagation(); toggleNb(b.id); }}><${Icon} name="right" size=${12} /></button>
                  <a class="pt-link" href="#/notes" onClick=${() => { try { localStorage.setItem('ytos.nb', b.id); } catch {} if (nbHas(b.id) && !nbOpen(b.id)) toggleNb(b.id); }}><i class="nb-dot" style=${`background:${b.color}`}></i><span class="pt-t">${b.name}</span></a>
                  <button class="pt-add" title="新建页面" onClick=${() => { const n = newNote({ nb: b.id }); go('notes/' + n.id); }}><${Icon} name="plus" size=${11} /></button>
                </div>
                ${nbOpen(b.id) && nbHas(b.id) && html`<div class="nb-pages tree-in"><${PageTree} notes=${s.notes} nb=${b.id} activeId=${route.sub} open=${tree.open} toggle=${tree.toggle} onCreate=${(parent) => { const n = newNote({ parent }); if (parent) tree.openPath([parent]); go('notes/' + n.id); }} max=${200} openPath=${tree.openPath} /></div>`}
              </div>`)}
              <div class="tree-acts"><button class="pt-row flat new" onClick=${async () => { const v = await askPrompt('本子名称', '', { title: '新本子', placeholder: '比如：读书笔记' }); if (v && v.trim()) newNotebook(v.trim()); }}><span class="pt-ic"><${Icon} name="plus" size=${12} /></span><span class="pt-t">新本子</span></button><button class="tree-mini" title="全部展开" onClick=${() => tree.openPath(s.notes.map((n) => n.id))}>展开</button><button class="tree-mini" title="全部收起" onClick=${() => tree.closeAll()}>收起</button></div>
            </div>`}`;
        }); })()}
      </nav>
      ${s.settings.seal === false && html`<button class="side-ai" data-tip="汤圆" title="和汤圆聊聊（全屏）" onClick=${() => { setMenu(false); window.dispatchEvent(new CustomEvent('seal:open', { detail: { mode: 'full' } })); }}><span class="side-ai-ic"><${Icon} name="chat" size=${15} /></span><span class="nl">汤圆</span><kbd class="nl">⌘⇧K</kbd></button>`}
      <${MiniPomo} />
      <a class=${'side-user ' + (route.path === 'settings' ? 'active' : '')} href="#/settings" data-tip="设置" title="设置"><span class="side-avatar">${s.profile.avatar ? html`<img src=${s.profile.avatar} alt="" />` : (s.profile.name || 'R')[0]}</span><span class="flex1 nl"><b>${s.profile.name}</b><small>${s.settings.lastSync ? '已同步 ' + new Date(s.settings.lastSync).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '本地存储'}</small></span><${Icon} name="settings" size=${15} class="su-gear nl" /></a>
    </aside>
    ${!mini && html`<${Splitter} varName="sidebar" min=${180} max=${420} class="sp-side" />`}
    <div class="main">
      <header class="topbar">
        <${IconBtn} class="ibtn hamb" icon="menu" title="菜单" onClick=${() => setMenu(true)} />
        <div class="ttl crumb-top">${curNote ? html`<a href="#/notes">笔记</a>${ancestors(s.notes, curNote).map((a) => html`<span>/</span><a href=${'#/notes/' + a.id}>${noteTitle(a)}</a>`)}<span>/</span><b>${noteTitle(curNote)}</b>` : route.path === 'notes' && (route.sub || '').startsWith('canvas') ? (() => { const cid = route.sub.slice(7); const cv = cid && (s.canvases || []).find((c) => c.id === cid); return cv ? html`<a href="#/notes/canvas">画布</a><span>/</span><b class="crumb-edit" title="点一下改名" onClick=${async () => { const v = await askPrompt('画布名称', cv.title || '', { title: '重命名画布' }); if (v != null && v.trim()) update((d) => { const x = d.canvases.find((c) => c.id === cv.id); if (x) { x.title = v.trim(); x.updated = new Date().toISOString(); } }); }}>${cv.title || '未命名画布'}</b>` : html`<b>画布</b>`; })() : route.path === 'notes' && route.sub && !curNote ? html`<a href="#/notes">笔记</a><span>/</span><b>${{ tasks: '行动', graph: '图谱', tags: '标签', files: '附件' }[route.sub] || '笔记'}</b>` : route.path === 'plan' ? html`<a href="#/plan">计划</a><span>/</span><b>${{ week: '周计划', day: '每日时间线', weektl: '周时间线', monthtl: '月时间线', month: '月度目标' }[route.sub] || '周计划'}</b>` : html`<b>${active.name}</b>`}</div>
        <div class="sp"></div>
        <${IconBtn} class="ibtn tb-sticky" icon="tack" title="桌面便签（今天的焦点和安排，小窗口）" onClick=${() => popSticky()} />
        <${IconBtn} class="ibtn" icon="search" title="搜索（⌘K）" onClick=${() => setSearch(true)} />
        <button class="theme-glass" onClick=${toggleTheme} title="切换主题"><${Icon} name="moon" class="is" size=${15} /><${Icon} name="sun" class="im" size=${15} /></button>
        <${WinControls} />
      </header>
      <${SyncNudge} s=${s} />
      <main key=${route.path} class="fi"><${View} route=${route} /></main>
    </div>
    <${SearchPalette} open=${search} onClose=${() => setSearch(false)} />
    <${Capture} open=${cap} onClose=${() => setCap(false)} />
    <${Seal} key=${s.settings.seal === false ? 'ghost' : 'seal'} ghost=${s.settings.seal === false} />
    ${more && html`<${MoreSheet} s=${s} onClose=${() => setMore(false)} openNav=${() => { setMore(false); setMenu(true); }} />`}
    <nav class="tabbar" aria-label="主导航">
      <div class="tb-pill">
        ${[['home', '总览', 'home', (r) => r.path === 'home'], ['todos', '待办', 'checksq', (r) => r.path === 'todos'], ['today', '今天', 'sun', (r) => r.path === 'today'], ['notes', '笔记', 'note', (r) => r.path === 'notes']].map(([h, n, ic, m]) => html`<a key=${h} href=${'#/' + h} class=${m(route) ? 'active' : ''} aria-current=${m(route) ? 'page' : undefined}><${Icon} name=${ic} size=${22} /><span>${n}</span>${h === 'todos' && s.todos.filter((t) => !t.done).length > 0 && html`<i class="tb-badge">${Math.min(99, s.todos.filter((t) => !t.done).length)}</i>`}</a>`)}
        <button type="button" class=${more ? 'active' : ''} aria-expanded=${more} onClick=${() => setMore(!more)}><${Icon} name="grid" size=${22} /><span>更多</span></button>
      </div>
      <button type="button" class="tb-seal" onClick=${capture} aria-label=${s.settings.seal === false ? '记一下' : '汤圆助手'} title=${s.settings.seal === false ? '记一下' : '汤圆：说一句话，帮你拆成待办 / 时间块 / 笔记'}>${s.settings.seal === false ? html`<${Icon} name="plus" size=${24} />` : html`<img src="assets/seal-face.png" alt="" />`}</button>
    </nav>
  </div>`;
}

seedIfEmpty();
// 本地数据载入失败 / 存不下：必须让人看见，不能悄悄丢
import('./store.js').then(({ loadError }) => { if (loadError) toast('本地数据没能读出来，已原样另存，本次不会写回。先导出或联系开发者排查：' + loadError.slice(0, 60), { sticky: true }); });
window.addEventListener('ytos:persist-error', (e) => toast(e.detail === 'quota' ? '浏览器本地存储已满，新的改动存不下！删掉几张粘贴的大图片，或先导出备份。' : '本地保存失败：' + e.detail, { sticky: true }));
(() => {
  // topbar: frosted once scrolled; slides away while scrolling down, comes back on the first scroll up or near the top
  let last = window.scrollY, hidden = false;
  const h = () => {
    const y = window.scrollY, dy = y - last; last = y;
    document.body.classList.toggle('scrolled', y > 6);
    const want = y > 120 && dy > 3 ? true : dy < -3 || y < 60 ? false : hidden;
    if (want !== hidden) { hidden = want; document.body.classList.toggle('tb-hide', hidden); }
  };
  window.addEventListener('scroll', h, { passive: true }); h();
  window.addEventListener('hashchange', () => { hidden = false; document.body.classList.remove('tb-hide'); });
  // nudging the mouse to the very top brings it back too
  window.addEventListener('pointermove', (e) => { if (hidden && e.clientY < 8) { hidden = false; document.body.classList.remove('tb-hide'); } }, { passive: true });
})();
setExtraKinds(get().settings.kinds); setTagOverrides(get().settings.tagColors);
subscribe(() => { setExtraKinds(get().settings.kinds); setTagOverrides(get().settings.tagColors); });
// 滚动条：平时藏起来，滚动的时候才出现，停下一会儿又藏起来
(() => {
  const tm = new WeakMap();
  document.addEventListener('scroll', (e) => {
    const el = e.target === document ? document.documentElement : e.target; if (!el || !el.classList) return;
    el.classList.add('is-scrolling'); clearTimeout(tm.get(el)); tm.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900));
  }, { capture: true, passive: true });
})();
// 桌面版：标题栏融进网页，右上角三个按钮的颜色跟着主题变
initDesktop();
if (window.sealonote && !window.sealonote.win) {
  if (window.sealonote.setTitleBar) {
    const probe = document.createElement('i'); probe.style.cssText = 'position:fixed;width:0;height:0;visibility:hidden;background:var(--bg);color:var(--text-2)'; document.body.appendChild(probe);
    let last = '';
    const push = () => { const cs = getComputedStyle(probe); let bg = cs.backgroundColor; if (!bg || /rgba\(.*,\s*0\)$/.test(bg) || bg === 'transparent') bg = getComputedStyle(document.body).backgroundColor; const k = bg + cs.color; if (k === last) return; last = k; window.sealonote.setTitleBar({ color: bg, symbolColor: cs.color }); };
    new MutationObserver(() => requestAnimationFrame(push)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-skin', 'style', 'class'] });
    setTimeout(push, 50); setTimeout(push, 1000);
  }
}
applySizes();
setSearchRoutes(ROUTES);
initLiquid();
initGameFx();
detectLogin().then(async (login) => {
  // 换了账号（同一台电脑上另一个人登录）：先把上一个账号留在本机的数据备份起来，再从空白开始拉这个账号自己的云端数据，
  // 免得把上一个人的内容合并进新账号。第一次登录（本机还没记过账号）照常把本地数据带上去。
  if (login && login.user) {
    const id = login.user.email || 'gh:' + login.user.login; let prev = ''; try { prev = localStorage.getItem('ytos.account') || ''; } catch {}
    const migrating = prev.startsWith('gh:') && login.cloud && login.aiQuota === null; // 站长从 GitHub 登录换成邮箱登录：同一个人，数据照常带上去
    if (prev && prev !== id && !migrating) {
      try { const { kvSet } = await import('./files.js'); await kvSet('backup:' + prev, JSON.parse(JSON.stringify(get()))); await kvSet('sync-base', null); } catch {}
      const { replace, blank } = await import('./store.js'); const b = blank(); b.settings.seeded = true; replace(b);
      toast('换了账号：上一个账号在这台电脑上的数据已经备份在本机，现在显示的是 ' + (login.user.email || login.user.login) + ' 的数据');
    }
    try { localStorage.setItem('ytos.account', id); } catch {}
  }
  // 第一次登录、还没设过头像：直接用 GitHub 头像
  if (login && login.user && login.user.avatar && !get().profile.avatar) update((d) => { d.profile.avatar = login.user.avatar; });
  autoSync(subscribe);
});
// 便签窗口（#/sticky）：没有侧栏，只渲染便签；点到别的页面交给主窗口
// 汤圆单独窗口（#/seal）：只有对话
// 桌面汤圆（#/pet）：透明小窗口里只有汤圆
const BARE = /^#\/sticky/.test(location.hash) ? 'sticky' : /^#\/seal(\?|$)/.test(location.hash) ? 'seal' : /^#\/pet(\?|$)/.test(location.hash) ? 'pet' : '';
const STICKY = !!BARE;
if (BARE) {
  document.documentElement.classList.add('is-bare', BARE === 'sticky' ? 'is-sticky' : BARE === 'pet' ? 'is-pet' : 'is-seal-win');
  document.title = BARE === 'sticky' ? '便签 · Sealonote' : '汤圆 · Sealonote';
  keepSticky(BARE === 'sticky' ? '#/sticky' : BARE === 'pet' ? '#/pet' : '#/seal');
  // 没有 App 外壳，主题要自己跟上（深浅色 / 风格改了，这些小窗口也跟着变）
  const themeNow = () => { const st = get().settings; applyTheme(st.theme, st.skin || 'notion', st.fx || 'lite', st.sealGlow !== false, st.sealAccent || 'none'); };
  themeNow(); let tk = ''; subscribe(() => { const st = get().settings; const k = [st.theme, st.skin, st.fx, st.sealGlow, st.sealAccent].join('|'); if (k !== tk) { tk = k; themeNow(); } });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeNow);
}
await initI18n(); // 英文界面：先把词典准备好，免得先闪一下中文
// 打开时先进哪一页（设置 → 总览 → 打开时显示）：默认「今天」；「上次看的」记在本机
if (!BARE) {
  const KEY = 'ytos.lastRoute';
  if (!/^#\/./.test(location.hash)) {
    const pref = (get().settings || {}).startPage || 'today';
    let to = pref === 'home' ? 'home' : 'today';
    if (pref === 'last') { try { const v = localStorage.getItem(KEY) || ''; if (/^#\/[\w-]/.test(v)) to = v.slice(2); } catch {} }
    history.replaceState(null, '', '#/' + to);
  }
  const remember = () => { if (/^#\/(settings|seal|sticky|pet)\b/.test(location.hash)) return; try { localStorage.setItem(KEY, location.hash); } catch {} };
  remember(); window.addEventListener('hashchange', remember);
}
render(BARE === 'seal' ? html`<${Seal} standalone />` : BARE === 'pet' ? html`<${Pet} />` : BARE ? html`<${Sticky} />` : html`<${App} />`, document.getElementById('app'));
// 过了半夜（桌面版、标签页一直开着）：「今天」换了，整个界面重新算一遍——没在打字时直接刷新；窗口重新回到前台时也看一眼
(() => {
  let day = todayStr();
  const check = () => {
    if (todayStr() === day) return;
    const el = document.activeElement; const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    if (typing || document.querySelector('.modal-bg, #ctx-host .pm')) return; // 等你打完字 / 关掉弹窗
    day = todayStr(); location.reload();
  };
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
})();
// 时间块撞了别的事被挪开时，告诉一声挪到了哪（同一时间只放一件事，见 nooverlap.js）
window.addEventListener('blocks:moved', (e) => { const m = e.detail || {}; toast(m.kind === 'end' ? `「${(m.title || '时间块').slice(0, 16)}」停在 ${m.to}，后面是「${(m.past || '').slice(0, 12)}」` : m.kind === 'start-edge' ? `「${(m.title || '时间块').slice(0, 16)}」从 ${m.to} 开始，前面是「${(m.past || '').slice(0, 12)}」` : `「${(m.title || '时间块').slice(0, 16)}」和「${(m.past || '').slice(0, 12)}」撞了，挪到 ${m.to}`); });
// 待办的提醒：主窗口里每 30 秒看一眼，到点弹系统通知 + 页面提示（便签 / 汤圆小窗口不重复响）
if (!BARE) import('./remind.js').then(({ startReminders }) => startReminders((t, r) => toast(`⏰ ${t.title}${r.d ? ` · ${r.d} 天后到期` : ''}${t.time ? ' · ' + t.time : ''}`, { label: '打开', onClick: () => go('todos?open=' + t.id), sticky: true })));
// 记下这台设备的时区：Claude 连接器（/mcp）在服务端按它算「今天」
if (!BARE) setTimeout(() => { try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz && get().settings.tz !== tz) update((d) => { d.settings.tz = tz; }); } catch {} }, 3000);
// 订阅扣费前提醒：打开网站几秒后看一眼（同步拉到最新的再提醒），每个订阅每天只提醒一次
if (!STICKY) setTimeout(() => { try { remindDue(toast, go); } catch {} }, 4000);
