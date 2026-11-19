// 便签：两种模式
//  · 今天：今日 / 明日焦点（就是待办）+ 今天接下来的时间块和检查点（就是计划）
//  · 便利贴：贴在便签上的笔记。便利贴本身就是一页笔记（note.sticky = 颜色），存在同一个数据库里、跟着账号同步，
//    默认放在「便利贴」本子里，也可以放进任何一个本子；反过来任何一页笔记也能「贴到便签」。
// 用在三个地方：侧栏的「便签」页（#/stickies）、网页弹出的小窗口和桌面版的便签窗口（都是 #/sticky，没有侧栏）。
import { html, useState, useEffect, useMemo, useRef, createPortal } from '../../vendor/preact.js';
import { useStore, upsert, update, get, toggleTodo, removeUndo } from '../store.js';
import { Icon } from '../ui.js';
import { todayStr, addDays, sortBy, timeToMin, fmtShort, nowISO, kindColor, mdLabel, uid, relDay, PRIORITY } from '../util.js';
import { askPrompt } from '../confirm.js';
import { scheduleTodo } from '../schedule.js';
import { mdToBlocks } from '../blocks.js';
import { ctxMenu } from '../ctx.js';
import { toast, go } from '../nav.js';
import { focusOn, setFocus, MAX_FOCUS } from './daily.js';
import { quickParse, postponeItems } from './todos.js';
import * as pomo from '../pomo.js';
import { isCheck, checkState, checkMenu, BlockModal } from './planner.js';
import { newNote, ensureNotebook, trashPages, noteTitle } from './notes.js';

// 桌面版里 preload 会挂上 window.sealonote；网页弹窗里用 opener
export const inApp = () => typeof window !== 'undefined' && !!window.sealonote;
const isStickyWin = () => /^#\/sticky(\?|$)/.test(location.hash);
export function openMain(path) {
  const hash = '#/' + String(path || 'home').replace(/^#?\/?/, '');
  if (!isStickyWin()) { location.hash = hash; return; }
  if (window.sealonote) { window.sealonote.openMain(hash); return; }
  try { if (window.opener && !window.opener.closed) { window.opener.location.hash = hash; window.opener.focus(); return; } } catch {}
  window.open(location.pathname + hash, '_blank');
}
// 网页版：开一个小窗口当便签（桌面版里换成真正的桌面便签窗口）
export function popSticky(mode) {
  if (window.sealonote) { window.sealonote.showSticky(); return; }
  const w = window.open(location.pathname + '#/sticky' + (mode ? '?mode=' + mode : ''), 'sealonote-sticky', 'popup=yes,width=340,height=520');
  if (w) try { w.focus(); } catch {}
}

const hm = (d) => d.getHours() * 60 + d.getMinutes();
const wd = (d) => '日一二三四五六'[new Date(d.replace(/-/g, '/')).getDay()];
const pad = (n) => String(n).padStart(2, '0');
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  return now;
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ---------- 今天：一个列表 ---------- */
// 小窗口只做一件事：今天要做的。最上面一个输入框（写一句话回车就加上，「3点 组会」会带上时间），
// 下面一个列表：★ 标星的（就是焦点）在最前，其余按时间排，待办和时间块混在一起；勾掉就完成，双击改名，右键改时间 / 推迟 / 删除。
// 不用切今天 / 明天、不分好几块、点一下也不跳去主窗口。
const kindC = (k) => kindColor(k || 'focus');
export const stickyList = (s) => s.notes.filter((n) => n.sticky).sort((a, b) => (b.stickyAt || b.updated || '').localeCompare(a.stickyAt || a.updated || ''));
export function TodayPane({ s, now }) {
  const today = todayStr(), nowMin = hm(now);
  const [blk, setBlk] = useState(null); const [editId, setEditId] = useState(''); const [text, setText] = useState('');
  const [doneOpen, setDoneOpen] = useState(() => lsGet('ytos.sk.done', '0') === '1');
  const stars = focusOn(s, today).filter((t) => !t.done);
  const open = s.todos.filter((t) => !t.done && t.focus !== today && t.due && t.due <= today);
  const done = sortBy(s.todos.filter((t) => t.done && !t.dropped && t.completedAt === today), '-completedAt');
  const mine = new Set([...stars, ...open].map((t) => t.id));
  const blocks = s.blocks.filter((b) => b.date === today && !b.pomo && !(b.todoId && mine.has(b.todoId))).filter((b) => (isCheck(b) ? !b.status || timeToMin(b.start) >= nowMin - 60 : timeToMin(b.end || b.start) > nowMin));
  // 过期的排最前（提醒一下），再按时间；没写时间的放在有时间的后面
  const key = (r) => (r.late ? '0' : '1') + (r.tm || '99:99');
  const rest = [...open.map((t) => ({ t, tm: t.time || '', late: t.due < today })), ...blocks.map((b) => ({ b, tm: b.start }))].sort((x, y) => key(x).localeCompare(key(y)));

  const add = () => {
    const v = text.trim(); if (!v) return; const q = quickParse(v); const id = uid(); const due = q.due || today;
    upsert('todos', { id, title: q.title || v, done: false, priority: q.priority, due, time: q.time || '', tags: q.tags || [], area: '', note: '', created: today });
    if (q.time && due >= today) { const t = get().todos.find((x) => x.id === id); if (t) { if (q.end) upsert('blocks', { id: uid(), date: due, start: q.time, end: q.end, title: t.title, kind: 'focus', note: '', todoId: id }); else scheduleTodo(t, due, { exact: true }); } }
    if (due !== today) toast(`加到了${relDay(due)}${q.time ? ' ' + q.time : ''}`);
    setText('');
  };
  const star = (t) => { if (t.focus === today) { setFocus(t, ''); return; } if (stars.length >= MAX_FOCUS) { toast('星标最多 3 件——少一点才是重点'); return; } setFocus(t, today); };
  const check = (e, t) => {
    const row = e.currentTarget.closest('.sk-it');
    if (t.done || !row || matchMedia('(prefers-reduced-motion: reduce)').matches) { toggleTodo(t.id); return; }
    if (row.classList.contains('checking')) return; row.classList.add('checking'); setTimeout(() => toggleTodo(t.id), 380);
  };
  const rename = (t, v) => { setEditId(''); v = (v || '').trim(); if (v && v !== t.title) upsert('todos', { id: t.id, title: v }); };
  const setTime = async (t) => {
    const v = await askPrompt('几点做？比如「15:00」「下午3点」；留空就是今天内完成', t.time || '', { title: t.title.slice(0, 30), placeholder: '15:00' }); if (v == null) return;
    const tm = v.trim() ? quickParse(v).time : ''; if (v.trim() && !tm) { toast('没看懂这个时间，换个写法试试：15:00'); return; }
    upsert('todos', { id: t.id, time: tm, ...(t.due && t.due >= today ? {} : { due: today }) });
  };
  const menu = (e, t) => { e.preventDefault(); ctxMenu(e, [
    { label: t.focus === today ? '取消星标' : '标星（今天最重要的）', icon: 'star', onClick: () => star(t) },
    { label: '改名', icon: 'edit', hint: '双击', onClick: () => setEditId(t.id) },
    { label: t.time ? `改时间（${t.time}）…` : '设个时间…', icon: 'clock', onClick: () => setTime(t) },
    { label: '推迟', icon: 'right', sub: postponeItems(t) },
    'sep',
    { label: '在主窗口里打开', icon: 'external', onClick: () => openMain('todos?open=' + t.id) },
    { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('todos', t.id, t.title) },
  ], t.title); };
  const todoRow = (t, opt = {}) => html`<div key=${t.id} class=${'sk-it sk-td' + (t.done ? ' done' : '') + (opt.late ? ' late' : '')} style=${`--pc:${(PRIORITY.find((p) => p.v === t.priority) || PRIORITY[2]).color}`} onContextMenu=${(e) => !t.done && menu(e, t)} onDblClick=${() => !t.done && setEditId(t.id)}>
    <button type="button" class="sk-cb" aria-label=${t.done ? '标为未完成' : '完成'} onClick=${(e) => check(e, t)}><${Icon} name="check" size=${10} /></button>
    ${editId === t.id ? html`<input class="sk-ed" value=${t.title} ref=${(el) => el && !el.dataset.f && (el.dataset.f = '1', el.focus(), el.select())} onKeyDown=${(e) => { if (e.key === 'Enter') rename(t, e.target.value); if (e.key === 'Escape') setEditId(''); }} onBlur=${(e) => rename(t, e.target.value)} />`
      : html`<span class="sk-ti" title=${t.title}>${t.title}</span>`}
    ${opt.late && html`<em class="sk-late">${relDay(t.due)}</em>`}
    ${t.time && !t.done && html`<small class="sk-at">${t.time}</small>`}
    ${!t.done && html`<button type="button" class=${'sk-star' + (t.focus === today ? ' on' : '')} title=${t.focus === today ? '取消星标' : '标星：今天最重要的（最多 3 件）'} onClick=${() => star(t)}><${Icon} name="star" size=${12} /></button>`}
  </div>`;
  const blkRow = (b) => { const ck = isCheck(b); const st = ck ? checkState(b, today, nowMin) : ''; const cur = !ck && timeToMin(b.start) <= nowMin && timeToMin(b.end) > nowMin;
    const act = (e) => (ck ? checkMenu(e, b, (x) => setBlk({ block: x })) : setBlk({ block: b }));
    return html`<div key=${b.id} class=${'sk-it sk-bk' + (cur ? ' cur' : '') + (ck ? ' ck ' + st : '')} style=${`--bc:${kindC(b.kind)}`} onClick=${act} onContextMenu=${(e) => { e.preventDefault(); act(e); }} title="时间块：点一下编辑">
      ${ck ? html`<i class="sk-dia">${st === 'ok' ? html`<${Icon} name="check" size=${8} />` : st === 'miss' ? html`<${Icon} name="x" size=${8} />` : ''}</i>` : html`<i class="sk-dot"></i>`}
      <span class="sk-ti">${b.title || '（未命名）'}</span>
      <small class="sk-at">${cur ? `还剩 ${timeToMin(b.end) - nowMin} 分` : b.start}</small>
    </div>`; };
  const empty = !stars.length && !rest.length;
  return html`<div class="sk-pane today2">
    <div class="sk-day"><b>${mdLabel(now, true)}</b>${(stars.length + rest.length) > 0 && html`<span>${stars.length + open.length} 件待办${blocks.length ? ` · ${blocks.length} 个时间块` : ''}</span>`}</div>
    <${NowCard} />
    <div class="sk-add2"><${Icon} name="plus" size=${14} /><input type="text" value=${text} placeholder="加一件事，回车（「3点 组会」会带上时间）" onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) add(); if (e.key === 'Escape') setText(''); }} /></div>
    ${empty ? html`<p class="sk-none"><b>今天没有要做的事了</b><span>在上面写一件，回车就加上</span></p>`
      : html`<div class="sk-ls">${stars.map((t) => todoRow(t))}${stars.length > 0 && rest.length > 0 && html`<i class="sk-sep"></i>`}${rest.map((r) => (r.t ? todoRow(r.t, { late: r.late }) : blkRow(r.b)))}</div>`}
    ${done.length > 0 && html`<div class="sk-done">
      <button type="button" class="sk-fold" onClick=${() => { setDoneOpen(!doneOpen); lsSet('ytos.sk.done', doneOpen ? '0' : '1'); }}><${Icon} name=${doneOpen ? 'down' : 'right'} size=${11} />今天完成了 ${done.length} 件</button>
      ${doneOpen && html`<div class="sk-ls">${done.map((t) => todoRow(t))}</div>`}
    </div>`}
    <${BlockModal} open=${!!blk} block=${blk && blk.block} start=${(blk && blk.start) || '09:00'} date=${today} onClose=${() => setBlk(null)} />
  </div>`;
}

// 便签里的番茄钟：「今天」里最上面一张「正在做」卡片（不跳去专注页）；在「便利贴」和单张便利贴里只是标题栏上一个小胶囊
function usePomo() {
  const [st, setSt] = useState(pomo.get()); useEffect(() => pomo.subscribe((x) => setSt({ ...x })), []);
  const [, tick] = useState(0); useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return st;
}
export function NowCard() {
  const st = usePomo();
  if (st.phase === 'idle' && !st.review) return null;
  if (st.phase === 'idle') return html`<div class="now-card rv"><div class="nc-k">这一轮结束了</div><div class="nc-t">${st.review.label || '专注'} · ${st.review.mins} 分钟</div><div class="nc-acts"><button type="button" class="nc-main" onClick=${() => openMain('focus')}>记一下做到哪了</button><button type="button" onClick=${() => pomo.dismissReview()}>不记了</button></div></div>`;
  const rem = pomo.remaining(); const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const pct = total ? Math.min(100, Math.max(0, 100 - (rem / total) * 100)) : 0;
  // 一行：大号剩余时间 + 状态/名字 + 三个圆图标按钮；底下一条细进度。比原来矮一半，不抢下面待办的位置
  const brk = st.phase === 'break';
  return html`<div class=${'now-card ' + st.phase + (st.paused ? ' paused' : '')}>
    <div class="nc-row">
      <b class="nc-time">${pomo.fmt(rem)}</b>
      <div class="nc-tx"><span class="nc-k">${brk ? '休息' : st.paused ? '暂停中' : '正在做'}</span><span class="nc-t">${brk ? '起来走走，喝口水' : st.label || '专注'}</span></div>
      <div class="nc-acts">
        ${!brk && html`<button type="button" class="nc-main" title=${st.paused ? '继续' : '暂停'} aria-label=${st.paused ? '继续' : '暂停'} onClick=${() => (st.paused ? pomo.resume() : pomo.pause())}><${Icon} name=${st.paused ? 'play' : 'pause'} size=${12} /></button>`}
        ${!brk && html`<button type="button" title="这轮到这（记下来）" aria-label="这轮到这" onClick=${() => pomo.stop(true)}><${Icon} name="check" size=${12} /></button>`}
        <button type="button" title=${brk ? '跳过休息' : '放弃这一轮'} aria-label=${brk ? '跳过休息' : '放弃'} onClick=${() => (brk ? pomo.skip() : pomo.stop(false))}><${Icon} name=${brk ? 'right' : 'x'} size=${12} /></button>
      </div>
    </div>
    <i class="nc-bar"><i style=${`width:${pct}%`}></i></i>
  </div>`;
}
export function PomoPill({ onOpen }) {
  const st = usePomo(); if (st.phase === 'idle') return null;
  // 一个小计时环（走了多少就填多少）+ 剩余时间：一看就是番茄钟，不和优先级的小色点混
  const rem = pomo.remaining(); const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const f = total ? Math.min(1, Math.max(0, 1 - rem / total)) : 0; const C = 2 * Math.PI * 5.5;
  return html`<button type="button" class=${'pomo-pill ' + st.phase + (st.paused ? ' paused' : '')} title=${`${st.phase === 'break' ? '休息中' : st.paused ? '暂停中' : '正在专注'}：${st.label || '专注'}（点开看）`} onClick=${onOpen}>
    <svg class="pp-ring" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" class="pp-tr" /><circle cx="7" cy="7" r="5.5" class="pp-fg" style=${`stroke-dasharray:${C};stroke-dashoffset:${C * (1 - f)}`} />${st.paused && html`<path d="M5.6 5v4M8.4 5v4" class="pp-pz" />`}</svg>
    <span>${pomo.fmt(rem)}</span>
  </button>`;
}

/* ---------- 便利贴 ---------- */
export const STICKY_COLORS = [['yellow', '黄', '#f5d76e'], ['pink', '粉', '#f4a7c0'], ['blue', '蓝', '#9cc3f5'], ['green', '绿', '#a8dbb0'], ['purple', '紫', '#c7b3f0'], ['gray', '灰', '#d3d5da']];
const SIMPLE = new Set(['p', 'bullet', 'number', 'todo', 'quote', 'h1', 'h2', 'h3', 'toggle']);
// 只有简单文字的页面才在便利贴里直接改（表格、图片这些在便利贴里改会丢格式，点开去笔记里改）
const editable = (n) => !(n.blocks || []).some((b) => !SIMPLE.has(b.type));
// 新的一张换个颜色：接着最近一张往下轮（黄 → 粉 → 蓝 → 绿 → 紫），墙上不会一片黄
const nextColor = () => { const order = ['yellow', 'pink', 'blue', 'green', 'purple']; const last = sortBy(get().notes.filter((n) => n.sticky), '-stickyAt')[0]; const i = last ? order.indexOf(last.sticky) : -1; return order[(i + 1) % order.length]; };
export function addSticky(color) {
  color = color || nextColor();
  const nb = ensureNotebook('便利贴', '#c7873a');
  return newNote({ nb: nb.id, sticky: color, stickyAt: nowISO(), title: '', body: '', blocks: [] });
}
export function stickyMenuItem(n) {
  return { label: n.sticky ? '从便签上取下' : '贴到便签', icon: 'tack', hint: n.sticky ? '页面还在' : '', onClick: () => { upsert('notes', { id: n.id, sticky: n.sticky ? '' : 'yellow', stickyAt: n.sticky ? '' : nowISO() }); toast(n.sticky ? '已从便签上取下' : '已贴到便签'); } };
}
const firstLine = (t) => (t || '').split('\n').map((l) => l.replace(/^\s*(#+|[-*]|\d+[.)]|>|\[[ x]\])\s*/i, '').trim()).find(Boolean) || '';
const excerpt = (n) => (n.body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*`|]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 240);

// 把一张便利贴 / 一页笔记单独贴到桌面：桌面版开一个独立的小窗口（各自记位置、大小、置顶、透明度）；网页版弹一个小窗口
export function popNote(id, at) {
  if (window.sealonote && window.sealonote.popNote) { window.sealonote.popNote(id, at); return; }
  const w = window.open(location.pathname + '#/sticky?note=' + id, 'sealonote-note-' + id, 'popup=yes,width=300,height=320' + (at ? `,left=${Math.round(at.x)},top=${Math.round(at.y)}` : ''));
  if (w) try { w.focus(); } catch {}
}
const toggleTheme = () => update((d) => { d.settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
function ThemeBtn() {
  return html`<button type="button" class="sk-ib" title="切换白天 / 黑夜" onClick=${toggleTheme}><${Icon} name="moon" size=${14} class="is" /><${Icon} name="sun" size=${14} class="im" /></button>`;
}

// 便利贴的文字：自己打字时不被同步回来的旧内容盖掉；停 0.4 秒存一次
function useStickyText(n) {
  const [text, setText] = useState(n.body || '');
  const focused = useRef(false); const timer = useRef();
  useEffect(() => { if (!focused.current) setText(n.body || ''); }, [n.body]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onInput = (e) => { const v = e.target.value; setText(v); clearTimeout(timer.current); timer.current = setTimeout(() => { const cur = get().notes.find((x) => x.id === n.id); if (!cur || cur.body === v) return; upsert('notes', { id: n.id, body: v, blocks: mdToBlocks(v), title: firstLine(v).slice(0, 40), updated: nowISO() }); }, 400); };
  return { text, onInput, onFocus: () => { focused.current = true; }, onBlur: () => { focused.current = false; } };
}
// 新的一张 / 复制一张：桌面单张窗口里直接再弹一个窗口出来
export function newSticky({ from, text = '', pop = false } = {}) {
  const c = addSticky(from && from.sticky);
  const body = from ? from.body || '' : text;
  if (body) upsert('notes', { id: c.id, body, blocks: mdToBlocks(body), title: firstLine(body).slice(0, 40) });
  if (pop) popNote(c.id); return c;
}
function noteMenuItems(n, s) {
  return [
    n.sticky && { label: '新的一张', icon: 'plus', hint: 'Ctrl+N', onClick: () => newSticky({ pop: isStickyWin() }) },
    n.sticky && { label: '复制一张', icon: 'layers', onClick: () => newSticky({ from: n, pop: isStickyWin() }) },
    n.sticky && { label: '换颜色', icon: 'tag', sub: STICKY_COLORS.map(([c, name, hex]) => ({ label: name, color: hex, icon: c === n.sticky ? 'check' : '', onClick: () => upsert('notes', { id: n.id, sticky: c }) })) },
    { label: '放进本子', icon: 'book', hint: (s.notebooks.find((b) => b.id === n.nb) || {}).name || '', sub: sortBy(s.notebooks, 'order').map((b) => ({ label: b.name, icon: b.id === n.nb ? 'check' : 'book', onClick: () => { update((d) => { const x = d.notes.find((y) => y.id === n.id); if (x) { x.nb = b.id; x.parent = null; x.updated = nowISO(); } }); toast(`已放进「${b.name}」`); } })) },
    { label: '在主窗口的笔记里打开', icon: 'note', onClick: () => openMain('notes/' + n.id) },
    'sep',
    n.sticky ? { label: '从便签上取下', icon: 'tack', hint: '页面还在本子里', onClick: () => upsert('notes', { id: n.id, sticky: '', stickyAt: '' }) } : stickyMenuItem(n),
    n.sticky && { label: '删除', icon: 'trash', danger: true, onClick: () => trashPages([n.id], noteTitle(n)) },
  ].filter(Boolean);
}

function StickyCard({ n, s, autoFocus, onDone, onOpen, foot }) {
  const can = editable(n); const ta = useRef(); const tx = useStickyText(n);
  const fit = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(320, el.scrollHeight + 2) + 'px'; };
  useEffect(fit, [tx.text]);
  useEffect(() => { if (autoFocus && ta.current) { ta.current.focus(); onDone && onDone(); } }, [autoFocus]);
  const menu = (e) => ctxMenu(e, noteMenuItems(n, s), noteTitle(n) || '便利贴');
  // 按住顶上那条往窗口外拖：松手的地方变成一张独立的便利贴；拖进别的软件就是把文字粘过去
  const dragStart = (e) => { try { e.dataTransfer.setData('text/plain', n.body || ''); e.dataTransfer.effectAllowed = 'copy'; } catch {} };
  const dragEnd = (e) => {
    const out = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth || e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight;
    if (out && e.dataTransfer && e.dataTransfer.dropEffect === 'none') popNote(n.id, { x: e.screenX - 40, y: e.screenY - 12 });
  };
  return html`<div class=${'stk stk-' + (n.sticky || 'yellow')} onContextMenu=${menu}>
    <div class="stk-grip" draggable="true" title="按住拖到窗口外面：变成一张单独的便利贴" onDragStart=${dragStart} onDragEnd=${dragEnd}></div>
    <div class="stk-tools"><button type="button" class="stk-b" title="单独贴到桌面（可以随意拖动、放大缩小）" onClick=${() => popNote(n.id)}><${Icon} name="external" size=${12} /></button><button type="button" class="stk-b" title="更多" onClick=${menu}><${Icon} name="dots" size=${13} /></button></div>
    ${can ? html`<textarea ref=${ta} class="stk-ta" rows="2" value=${tx.text} placeholder="写点什么…" onFocus=${tx.onFocus} onBlur=${tx.onBlur} onInput=${tx.onInput}></textarea>`
      : html`<button type="button" class="stk-pre" title="点开看全文" onClick=${() => onOpen(n.id)}>${n.title && html`<b>${n.title}</b>`}<span>${excerpt(n) || '（打开查看）'}</span></button>`}
    ${foot && html`<div class="stk-foot"><span>${stkWhen(n.updated || n.created)}</span>${!can && html`<span>笔记页</span>`}</div>`}
  </div>`;
}

/* ---------- 一页笔记 / 一张便利贴：占满窗口 ---------- */
const safeUrl = (u) => (/^(https?:|data:image\/|blob:)/.test(u || '') ? u : '');
function ReadBlocks({ blocks }) {
  let n = 0;
  return html`<div class="nv-read">${(blocks || []).map((b, i) => {
    const h = { dangerouslySetInnerHTML: { __html: b.html || '' } }; const ind = b.indent ? `margin-left:${b.indent * 18}px` : '';
    if (b.type === 'number') n = i > 0 && blocks[i - 1].type === 'number' ? n + 1 : 1;
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': return html`<div key=${b.id} class=${'nv-' + b.type} ...${h}></div>`;
      case 'bullet': case 'toggle': return html`<div key=${b.id} class="nv-li" style=${ind}><i>•</i><span ...${h}></span></div>`;
      case 'number': return html`<div key=${b.id} class="nv-li" style=${ind}><i>${n}.</i><span ...${h}></span></div>`;
      case 'todo': return html`<div key=${b.id} class=${'nv-li nv-todo ' + (b.checked ? 'done' : '')} style=${ind}><i>${b.checked ? '☑' : '☐'}</i><span ...${h}></span></div>`;
      case 'quote': case 'callout': return html`<blockquote key=${b.id} ...${h}></blockquote>`;
      case 'code': return html`<pre key=${b.id} ...${h}></pre>`;
      case 'divider': return html`<hr key=${b.id} />`;
      case 'image': return safeUrl(b.url) ? html`<img key=${b.id} src=${safeUrl(b.url)} alt="" />` : null;
      case 'table': return html`<table key=${b.id}>${(b.rows || []).map((r, ri) => html`<tr key=${ri}>${r.map((c, ci) => html`<td key=${ci} dangerouslySetInnerHTML=${{ __html: c || '' }}></td>`)}</tr>`)}</table>`;
      case 'file': return html`<p key=${b.id} class="nv-file">📎 ${b.name || '附件'}</p>`;
      case 'pending': return null;
      default: return html`<p key=${b.id} ...${h}></p>`;
    }
  })}</div>`;
}
export function NoteView({ s, id, single, onBack }) {
  const n = s.notes.find((x) => x.id === id);
  const [pin, setPin] = useState(null); const [op, setOp] = useState(1); const [opOpen, setOpOpen] = useState(false);
  const desk = single && inApp() && !!window.sealonote.setOpacity;
  useEffect(() => { if (!desk) return; window.sealonote.getPin().then(setPin).catch(() => {}); window.sealonote.getOpacity().then(setOp).catch(() => {}); }, []);
  useEffect(() => { if (single) document.title = (n && (noteTitle(n) || '便利贴')) + ' · Sealonote'; }, [n && n.title]);
  const tx = useStickyText(n || { id: '', body: '' });
  if (!n) return html`<div class="nv"><div class="sk-bar">${!single && html`<button type="button" class="sk-ib" onClick=${onBack}><${Icon} name="left" size=${14} /></button>`}<span class="flex1"></span>${single && html`<button type="button" class="sk-ib" title="关闭" onClick=${() => (window.sealonote && window.sealonote.win ? window.sealonote.win.close() : window.close())}><${Icon} name="x" size=${14} /></button>`}</div><p class="sk-empty" style="padding:16px">这页已经删掉了。</p></div>`;
  // 便利贴直接改；普通笔记在这里只读（排版完整），要改点「在笔记里编辑」
  const can = !!n.sticky && editable(n);
  // 单张便利贴（桌面上那张小彩纸）：顶上只有「换颜色 · ＋ · 更多 · 关」，鼠标移上去才出现；置顶、透明度都收进「更多」
  const COL = ['yellow', 'pink', 'blue', 'green', 'purple'];
  const cycle = () => upsert('notes', { id: n.id, sticky: COL[(COL.indexOf(n.sticky) + 1) % COL.length] });
  const menu = (e) => ctxMenu(e, [
    desk && { label: pin ? '取消置顶' : '置顶（总在最前面）', icon: pin ? 'check' : 'tack', onClick: () => window.sealonote.setPin(!pin).then(setPin) },
    desk && { label: '透明度…', icon: 'eye', hint: Math.round(op * 100) + '%', onClick: () => setOpOpen(true) },
    desk && 'sep',
    ...noteMenuItems(n, s),
  ].filter(Boolean), noteTitle(n) || '便利贴');
  const close = () => (window.sealonote && window.sealonote.win ? window.sealonote.win.close() : window.close());
  const fresh = !(n.body || '').trim();
  return html`<div class=${'nv ' + (single ? 'single ' : '') + (n.sticky ? 'stk stk-' + n.sticky : '')} onContextMenu=${(e) => { if (e.target.tagName !== 'TEXTAREA') { e.preventDefault(); menu(e); } }}>
    <div class="sk-bar nv-bar">
      ${!single && html`<button type="button" class="sk-ib" title="返回" onClick=${onBack}><${Icon} name="left" size=${14} /></button>`}
      ${n.sticky ? html`<button type="button" class="nv-dot" title="换颜色" aria-label="换颜色" onClick=${cycle}></button>` : html`<span class="nv-t" title=${noteTitle(n)}>${noteTitle(n) || '无标题'}</span>`}
      <span class="flex1"></span>
      ${single && n.sticky && html`<button type="button" class="sk-ib" title="再贴一张（Ctrl+N）" onClick=${() => newSticky({ pop: true })}><${Icon} name="plus" size=${14} /></button>`}
      <button type="button" class="sk-ib" title="更多" onClick=${menu}><${Icon} name="dots" size=${14} /></button>
      ${single && html`<button type="button" class="sk-ib" title="收起（便利贴还在，便签里「贴过的便利贴」能找回）" onClick=${close}><${Icon} name="x" size=${14} /></button>`}
    </div>
    ${opOpen && desk && html`<${OpacityBar} op=${op} onChange=${(v) => { setOp(v); window.sealonote.setOpacity(v); }} onClose=${() => setOpOpen(false)} />`}
    ${can ? html`<textarea class="nv-ta" value=${tx.text} placeholder="写点什么…" ref=${(el) => el && fresh && single && !el.dataset.f && (el.dataset.f = '1', setTimeout(() => el.focus(), 30))} onFocus=${tx.onFocus} onBlur=${tx.onBlur} onInput=${tx.onInput}></textarea>`
      : html`<div class="nv-body">${n.title && !n.sticky && html`<h2 class="nv-h">${n.title}</h2>`}<${ReadBlocks} blocks=${n.blocks && n.blocks.length ? n.blocks : mdToBlocks(n.body)} /><button type="button" class="sk-more" onClick=${() => openMain('notes/' + n.id)}><${Icon} name="note" size=${12} />在笔记里编辑</button></div>`}
  </div>`;
}

// 便签窗口的快捷键：Ctrl/⌘+N 新的一张；没在打字时 Ctrl/⌘+V 把剪贴板里的文字贴成一张新便利贴
let keysOn = false;
export function stickyKeys() {
  if (keysOn) return; keysOn = true;
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); const pop = /[?&]note=/.test(location.hash) || (isStickyWin() && lsGet('ytos.stickyMode', 'today') !== 'notes'); const c = newSticky({ pop }); if (!pop) window.dispatchEvent(new CustomEvent('sticky:fresh', { detail: c.id })); } });
  window.addEventListener('paste', (e) => { if (typing(document.activeElement)) return; const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (!t || !t.trim()) return; e.preventDefault(); const c = newSticky({ text: t.trim(), pop: isStickyWin() }); toast('贴成了一张新便利贴'); if (!isStickyWin()) window.dispatchEvent(new CustomEvent('sticky:fresh', { detail: c.id })); });
}

/* ---------- 便签窗口（#/sticky）---------- */
// 顶上：「今天 | 便利贴 N」两页 · 「＋ 便利贴」· 更多（置顶、透明度、白天黑夜）· 收起
//  · 今天：一个列表（见 TodayPane）
//  · 便利贴：贴过的每一张都在这里，直接改字；右上角可以单独贴到桌面、换颜色、删除
export function OpacityBar({ op, onChange, onClose }) {
  return html`<div class="sk-op2"><${Icon} name="eye" size=${13} /><span>透明度</span><input type="range" min="30" max="100" step="1" value=${Math.round(op * 100)} onInput=${(e) => onChange(+e.target.value / 100)} /><b>${Math.round(op * 100)}%</b><button type="button" class="sk-op2-x" onClick=${onClose}>好</button></div>`;
}
export default function Sticky() {
  const s = useStore(); const now = useNow();
  useEffect(stickyKeys, []);
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  const single = q.get('note');
  const [mode, setModeS] = useState(() => (q.get('mode') === 'notes' || lsGet('ytos.stickyMode', 'today') === 'notes' ? 'notes' : 'today'));
  const setMode = (m) => { setModeS(m); lsSet('ytos.stickyMode', m); };
  const [pin, setPin] = useState(null); const [op, setOp] = useState(1); const [opOpen, setOpOpen] = useState(false);
  const [fresh, setFresh] = useState('');
  useEffect(() => { const h = (e) => { setMode('notes'); setFresh(e.detail); }; window.addEventListener('sticky:fresh', h); return () => window.removeEventListener('sticky:fresh', h); }, []);
  useEffect(() => {
    if (!window.sealonote || single) return;
    window.sealonote.getPin && window.sealonote.getPin().then(setPin).catch(() => {});
    window.sealonote.getOpacity && window.sealonote.getOpacity().then(setOp).catch(() => {});
  }, []);
  if (single) return html`<${NoteView} s=${s} id=${single} single />`;
  const desk = inApp() && !!(window.sealonote && window.sealonote.setOpacity);
  const setOpacity = (v) => { setOp(v); window.sealonote.setOpacity(v); };
  const list = stickyList(s);
  // 新的一张：在「便利贴」页里就地写；在「今天」页就直接贴到桌面上
  const addOne = () => { if (mode === 'notes') setFresh(addSticky().id); else newSticky({ pop: true }); };
  const more = (e) => ctxMenu(e, [
    inApp() && { label: pin ? '取消置顶' : '置顶（总在最前面）', icon: pin ? 'check' : 'tack', onClick: () => window.sealonote.setPin(!pin).then(setPin).catch(() => {}) },
    desk && { label: '透明度…', icon: 'eye', hint: Math.round(op * 100) + '%', onClick: () => setOpOpen(true) },
    { label: document.documentElement.dataset.theme === 'dark' ? '白天' : '黑夜', icon: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', onClick: toggleTheme },
    'sep',
    { label: '在主窗口里管理便利贴', icon: 'tack', onClick: () => openMain('stickies') },
    { label: '打开主窗口', icon: 'external', onClick: () => openMain('today') },
  ].filter(Boolean), '便签');
  return html`<div class="sticky">
    <div class="sk-bar">
      <div class="sk-seg sm sk-tabs">
        <button type="button" class=${mode === 'today' ? 'on' : ''} onClick=${() => setMode('today')}>今天</button>
        <button type="button" class=${mode === 'notes' ? 'on' : ''} onClick=${() => setMode('notes')}>便利贴${list.length > 0 && html`<i class="sk-tab-n">${list.length}</i>`}</button>
      </div>
      <span class="flex1"></span>
      <button type="button" class="sk-new" title=${mode === 'notes' ? '新便利贴（Ctrl+N）' : '在桌面上贴一张新便利贴（Ctrl+N）'} onClick=${addOne}><${Icon} name="plus" size=${12} />便利贴</button>
      <button type="button" class="sk-ib" title="更多" onClick=${more}><${Icon} name="dots" size=${14} /></button>
      ${inApp() && html`<button type="button" class="sk-ib" title="收起（托盘里可以再打开）" onClick=${() => window.sealonote.hideSticky()}><${Icon} name="x" size=${14} /></button>`}
    </div>
    ${opOpen && desk && html`<${OpacityBar} op=${op} onChange=${setOpacity} onClose=${() => setOpOpen(false)} />`}
    <div class="sk-body">${mode === 'notes'
      ? html`<div class="sk-pane sk-stks">${list.length === 0
          ? html`<button type="button" class="stk-empty" onClick=${addOne}><${Icon} name="plus" size=${14} />贴一张便利贴<small>写完会自动保存；右上角可以单独贴到桌面</small></button>`
          : html`<div class="stk-grid">${list.map((n) => html`<${StickyCard} key=${n.id} n=${n} s=${s} foot onOpen=${(id) => openMain('notes/' + id)} autoFocus=${fresh === n.id} onDone=${() => setFresh('')} />`)}</div>`}</div>`
      : html`<${TodayPane} s=${s} now=${now} />`}</div>
  </div>`;
}

/* ---------- 侧栏里的「便签」页（#/stickies）---------- */
// 便利贴上的时间：今天 14:20 / 昨天 / 11月3日
function stkWhen(iso) {
  if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; const t = todayStr(); const ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return ds === t ? `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}` : ds === addDays(t, -1) ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日`;
}
// 「从笔记添加」：挑一页笔记钉成便利贴
function NotePicker({ s, onClose }) {
  const [q, setQ] = useState(''); const inp = useRef();
  useEffect(() => { inp.current && inp.current.focus(); const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const list = useMemo(() => { const ql = q.trim().toLowerCase(); return sortBy(s.notes.filter((n) => !n.sticky && (noteTitle(n) || n.body)), '-updated').filter((n) => !ql || (noteTitle(n) + ' ' + (n.body || '')).toLowerCase().includes(ql)).slice(0, 40); }, [s.notes, q]);
  const pick = (n) => { upsert('notes', { id: n.id, sticky: nextColor(), stickyAt: nowISO() }); toast(`「${noteTitle(n)}」贴上来了`); onClose(); };
  return createPortal(html`<div class="stp-pick-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="stp-pick" role="dialog" aria-label="从笔记添加">
      <div class="stp-pick-h"><b>把一页笔记贴成便利贴</b><button type="button" class="ms-x" aria-label="关闭" onClick=${onClose}><${Icon} name="x" size=${14} /></button></div>
      <input ref=${inp} type="search" placeholder="搜笔记标题或内容…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <ul>${list.length ? list.map((n) => html`<li key=${n.id}><button type="button" onClick=${() => pick(n)}><${Icon} name="note" size=${14} /><span>${noteTitle(n)}</span><small>${stkWhen(n.updated)}</small></button></li>`) : html`<li class="stp-pick-none">没有找到</li>`}</ul>
    </div>
  </div>`, document.body);
}

export function StickiesPage() {
  const s = useStore();
  // 这一页上没在打字时 Ctrl/⌘+V：剪贴板里的文字贴成一张新便利贴
  useEffect(() => { const h = (e) => { const el = document.activeElement; if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; const x = e.clipboardData && e.clipboardData.getData('text/plain'); if (!x || !x.trim()) return; e.preventDefault(); const c = newSticky({ text: x.trim() }); setFresh(c.id); toast('贴成了一张新便利贴'); }; document.addEventListener('paste', h); return () => document.removeEventListener('paste', h); }, []);
  const alpha = s.settings.stickyAlpha == null ? 1 : s.settings.stickyAlpha;
  const list = stickyList(s);
  const [fresh, setFresh] = useState(''); const [pick, setPick] = useState(false); const [opt, setOpt] = useState(false);
  useEffect(() => { const h = (e) => setFresh(e.detail); window.addEventListener('sticky:fresh', h); return () => window.removeEventListener('sticky:fresh', h); }, []);
  const add = () => setFresh(addSticky().id);
  return html`<div class="stp stp2" style=${`--stk-a:${Math.round(alpha * 100)}%`}>
    <div class="stp2-h">
      <div><h1>便利贴</h1><p>${list.length ? `${list.length} 张 · 每张都是一页笔记，自动保存` : '随手记的东西贴在这里'}</p></div>
      <span class="flex1"></span>
      <button type="button" class="btn sm ghost" onClick=${() => setPick(true)}><${Icon} name="note" size=${14} />从笔记添加</button>
      <div class="stp2-pop">
        <button type="button" class="btn sm ghost" onClick=${() => popSticky('notes')} title="弹出便签小窗口，可以放在桌面上"><${Icon} name="tack" size=${14} />${inApp() ? '桌面便签' : '弹出小窗口'}</button>
        <button type="button" class=${'btn sm ghost stp2-more ' + (opt ? 'on' : '')} aria-label="小窗口设置" aria-expanded=${opt} onClick=${() => setOpt(!opt)}><${Icon} name="down" size=${13} /></button>
        ${opt && html`<div class="stp2-opt" onMouseLeave=${() => setOpt(false)}><label><span>小窗口透明度</span><input type="range" min="30" max="100" step="5" value=${Math.round(alpha * 100)} onInput=${(e) => update((d) => { d.settings.stickyAlpha = +e.target.value / 100; })} /><b>${Math.round(alpha * 100)}%</b></label><small>只影响弹出到桌面的便利贴</small></div>`}
      </div>
      <button type="button" class="btn sm primary" onClick=${add}><${Icon} name="plus" size=${14} />新便利贴</button>
    </div>
    ${list.length === 0 ? html`<div class="stp2-empty">
        <div class="stp2-demo" aria-hidden="true"><i class="stk-yellow"></i><i class="stk-pink"></i><i class="stk-blue"></i></div>
        <b>随手记的东西贴在这里</b>
        <p>一张便利贴就是一页笔记：会同步，也能放进任何本子。按 Ctrl+V 直接把剪贴板里的文字贴成一张。</p>
        <div class="stp2-empty-act"><button type="button" class="btn primary" onClick=${add}><${Icon} name="plus" size=${14} />贴第一张</button><button type="button" class="btn ghost" onClick=${() => setPick(true)}>从笔记添加</button></div>
      </div>`
      : html`<div class="stp2-wall">
        ${list.map((n) => html`<${StickyCard} key=${n.id} n=${n} s=${s} foot onOpen=${(id) => go('notes/' + id)} autoFocus=${fresh === n.id} onDone=${() => setFresh('')} />`)}
        <button type="button" class="stp2-add" onClick=${add} aria-label="新便利贴"><${Icon} name="plus" size=${20} /><span>新便利贴</span></button>
      </div>`}
    <p class="stp2-tip"><${Icon} name="cursor" size=${12} />鼠标移到便利贴上：右上角可以单独贴到桌面、换颜色；按住顶边拖出窗口，就变成一张独立的桌面便利贴</p>
    ${pick && html`<${NotePicker} s=${s} onClose=${() => setPick(false)} />`}
  </div>`;
}

// 小窗口里点到别的页面（比如「现在就做」会跳到专注）：交给主窗口打开，小窗口自己留在原地
export function keepSticky(base = '#/sticky') {
  const own = new RegExp('^' + base.replace(/[/#]/g, '\\$&') + '(\\?|$)');
  window.addEventListener('hashchange', (e) => {
    const h = location.hash;
    if (own.test(h)) return;
    const back = e && e.oldURL && e.oldURL.includes('#') ? e.oldURL.slice(e.oldURL.indexOf('#')) : base;
    history.replaceState(null, '', location.pathname + location.search + (own.test(back) ? back : base));
    if (window.sealonote) window.sealonote.openMain(h);
    else { try { if (window.opener && !window.opener.closed) { window.opener.location.hash = h; window.opener.focus(); return; } } catch {} window.open(location.pathname + h, '_blank'); }
  });
}
