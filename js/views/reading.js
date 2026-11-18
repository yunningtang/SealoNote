import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, upsert, remove, removeUndo, update, get } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, Progress, Stars, TagInput, confirmDel, Select } from '../ui.js';
import { uid, todayStr, sortBy, addDays, parseDate, lsGet, lsSet } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { dragProps, dropProps } from '../dnd.js';
import { linkedPage } from './notes.js';
import { go, toast } from '../nav.js';
import { askPrompt, askConfirm } from '../confirm.js';

const DEFAULT_TYPES = [['book', '书'], ['paper', '论文'], ['article', '文章'], ['course', '课程']];
// 类型可以在筛选条上右键改：存在 settings.readTypes，跟数据一起同步
export const typesOf = (s) => (Array.isArray(s.settings.readTypes) && s.settings.readTypes.length ? s.settings.readTypes : DEFAULT_TYPES);
const typeName = (s, v) => (typesOf(s).find(([k]) => k === v) || [])[1] || v;
export function typeMenu(e, s, v) {
  const types = typesOf(s);
  const save = (list) => update((d) => { d.settings.readTypes = list; });
  const items = [];
  if (v) {
    items.push({ label: '重命名', icon: 'edit', onClick: async () => { const n = await askPrompt('类型名称', typeName(s, v), { title: '重命名类型' }); if (n && n.trim()) save(types.map(([k, nm]) => (k === v ? [k, n.trim()] : [k, nm]))); } });
    items.push({ label: '删除类型', icon: 'trash', danger: true, disabled: types.length <= 1, hint: '里面的条目归到第一类', onClick: async () => { const cnt = s.books.filter((b) => b.type === v).length; if (cnt && !(await askConfirm(`${cnt} 本会改为「${types[0][0] === v ? types[1][1] : types[0][1]}」。`, { title: `删除类型「${typeName(s, v)}」？`, ok: '删除' }))) return; const rest = types.filter(([k]) => k !== v); update((d) => { d.settings.readTypes = rest; d.books.forEach((b) => { if (b.type === v) b.type = rest[0][0]; }); }); } });
    items.push('sep');
  }
  items.push({ label: '新建类型…', icon: 'plus', onClick: async () => { const n = await askPrompt('类型名称', '', { title: '新类型', placeholder: '比如：播客 / 漫画' }); if (n && n.trim()) save([...types, ['t-' + uid(), n.trim()]]); } });
  ctxMenu(e, items, v ? typeName(s, v) : '阅读类型');
}
// ---- 自动找封面：先 Google Books，再 Open Library ----
export async function findCover(title, author) {
  const q = [title, author].filter(Boolean).join(' ');
  if (!title) return '';
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent('intitle:' + title + (author ? ' inauthor:' + author : ''))}&maxResults=5`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const hit = (j.items || []).find((it) => it.volumeInfo && it.volumeInfo.imageLinks);
    if (hit) { const l = hit.volumeInfo.imageLinks; return (l.thumbnail || l.smallThumbnail).replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/zoom=\d/, 'zoom=2'); }
  } catch {}
  try {
    const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5&fields=cover_i`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const hit = (j.docs || []).find((d) => d.cover_i);
    if (hit) return `https://covers.openlibrary.org/b/id/${hit.cover_i}-M.jpg`;
  } catch {}
  return '';
}
export async function autoCover(b, quiet) {
  const url = await findCover(b.title, b.author);
  const cur = get().books.find((x) => x.id === b.id);
  if (url && cur && !cur.cover) { upsert('books', { id: b.id, cover: url }); if (!quiet) toast('找到封面了'); return true; }
  if (!quiet) toast(url ? '这本已经有封面' : '没找到合适的封面，可以手动贴图片链接');
  return false;
}
const STATUS = [['want', '想读'], ['reading', '在读'], ['done', '读完'], ['paused', '搁置']];
const COLORS = ['#2d8f88', '#3b6fd6', '#7461c9', '#c9588a', '#c7873a', '#2f6b5a', '#8a5a44', '#3c4a5a'];

// ---- 进度：可加可减；每天记一条，用来算读速和预计读完日 ----
const maxOf = (b) => (b.total > 0 ? b.total : 100);
export function setProgress(b, v) {
  const max = maxOf(b); const p = Math.max(0, Math.min(max, Math.round(+v || 0)));
  const today = todayStr();
  const log = [...(b.log || []).filter((x) => x.d !== today), { d: today, p }].sort((a, c) => (a.d < c.d ? -1 : 1)).slice(-120);
  const patch = { id: b.id, progress: p, log };
  if (p > 0 && !b.started) patch.started = today;
  if (p > 0 && b.status === 'want') patch.status = 'reading';
  upsert('books', patch);
}
// 最近 7 天读了多少、每天多少、预计哪天读完
export function paceOf(b) {
  const log = b.log || []; if (log.length < 2) return null;
  const today = todayStr(), from = addDays(today, -7);
  const before = [...log].reverse().find((x) => x.d <= from);
  const base = before ? before.p : (log[0].d > from ? 0 : log[0].p);
  const read = Math.max(0, b.progress - base);
  const days = before ? 7 : Math.max(1, Math.min(7, Math.round((parseDate(today) - parseDate(log[0].d)) / 864e5) + 1));
  const perDay = read / days;
  const left = maxOf(b) - b.progress;
  const eta = perDay > 0 && left > 0 ? addDays(today, Math.ceil(left / perDay)) : null;
  return { read, days, perDay, left, eta };
}
export function ProgressCtl({ b, compact }) {
  const max = maxOf(b);
  const [draft, setDraft] = useState(null);   // 拖动中的临时值
  const [edit, setEdit] = useState(false);    // 点数字直接改
  const val = draft != null ? draft : b.progress;
  const commit = (v) => { setDraft(null); setEdit(false); setProgress(b, v); };
  return html`<div class=${'pctl ' + (compact ? 'compact' : '')}>
    <input type="range" min="0" max=${max} step="1" value=${val} style=${`--p:${(val / max) * 100}%`} title="拖动调整进度" onInput=${(e) => setDraft(+e.target.value)} onChange=${(e) => commit(e.target.value)} onKeyDown=${(e) => e.stopPropagation()} />
    ${edit ? html`<input class="pctl-in mono" type="number" min="0" max=${max} value=${b.progress} ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, setTimeout(() => { el.focus(); el.select(); }, 0))} onBlur=${(e) => commit(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEdit(false); }} />`
      : html`<button class="pctl-v mono" title="点一下直接输入" onClick=${() => setEdit(true)}>${b.total > 0 ? `${val} / ${b.total}` : `${val}%`}</button>`}
  </div>`;
}

export function BookModal({ open, book, onClose }) {
  const [f, setF] = useState(null);
  const [finding, setFinding] = useState(false);
  useEffect(() => { if (open) setF(book ? { ...book } : { id: uid(), title: '', author: '', type: 'book', status: 'want', progress: 0, total: 0, rating: 0, cover: '', link: '', note: '', tags: [], color: COLORS[Math.floor(Math.random() * COLORS.length)], started: '', finished: '', created: todayStr() }); }, [open, book]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    if (!f.title.trim()) return;
    const out = { ...f, title: f.title.trim() };
    if (out.status === 'reading' && !out.started) out.started = todayStr();
    if (out.status === 'done') { if (!out.finished) out.finished = todayStr(); if (out.total) out.progress = out.total; else out.progress = 100; }
    upsert('books', out);
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${book ? '编辑' : '加入书架'} foot=${html`
    ${book && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { removeUndo('books', book.id, book.title || book.place || book.url); onClose(); }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <div class="grid2">
        <${Field} label="标题"><input type="text" autofocus value=${f.title} onInput=${(e) => set('title', e.target.value)} /><//>
        <${Field} label="作者"><input type="text" value=${f.author} onInput=${(e) => set('author', e.target.value)} /><//>
      </div>
      <div class="grid3">
        <${Field} label="类型"><${Select} value=${f.type} options=${typesOf(get()).map(([v, n]) => ({ v, label: n }))} onChange=${(v) => set('type', v)} /><//>
        <${Field} label="状态"><${Select} value=${f.status} options=${STATUS.map(([v, n]) => ({ v, label: n }))} onChange=${(v) => set('status', v)} /><//>
        <${Field} label="评分"><div style="padding-top:6px"><${Stars} value=${f.rating} onChange=${(v) => set('rating', v)} size=${16} /></div><//>
      </div>
      <div class="grid2">
        <${Field} label=${f.total ? '读到第几页 / 章' : '进度 %'}><input type="number" min="0" value=${f.progress} onInput=${(e) => set('progress', +e.target.value)} /><//>
        <${Field} label="总页数（可空）"><input type="number" min="0" value=${f.total} onInput=${(e) => set('total', +e.target.value)} /><//>
      </div>
      <div class="grid2">
        <${Field} label="封面图片 URL"><div class="row" style="gap:6px"><input class="flex1" type="url" value=${f.cover} placeholder="https://…" onInput=${(e) => set('cover', e.target.value)} /><${Btn} small kind="ghost" icon="search" disabled=${!f.title.trim() || finding} title="按书名和作者在 Google Books / Open Library 找封面" onClick=${async () => { setFinding(true); const u = await findCover(f.title, f.author); setFinding(false); if (u) set('cover', u); else toast('没找到合适的封面'); }}>${finding ? '找中…' : '自动找'}<//></div><//>
        <${Field} label="链接"><input type="url" value=${f.link} placeholder="豆瓣 / 原文 / PDF" onInput=${(e) => set('link', e.target.value)} /><//>
      </div>
      <${Field} label="封面色"><div class="row" style="gap:6px">${COLORS.map((c) => html`<button type="button" style=${`width:22px;height:22px;border-radius:50%;background:${c};outline:${f.color === c ? '2px solid var(--text)' : 'none'};outline-offset:2px`} onClick=${() => set('color', c)}></button>`)}</div><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="笔记 / 摘录 / 感想"><textarea rows="5" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

function Cover({ b, class: cls = '' }) {
  return html`<div class=${'cv ' + cls} style=${`--cc:${b.color || '#18a8a2'}`}>${b.cover ? html`<img src=${b.cover} alt="" loading="lazy" />` : b.title.slice(0, 10)}</div>`;
}

export default function Reading({ route }) {
  const s = useStore();
  useEffect(() => { const id = route && route.query && route.query.open; if (id && s.books.some((b) => b.id === id)) setOpen(id); }, [route && route.query && route.query.open]);
  const [status, setStatusS] = useState(() => lsGet('ytos.read.status', 'all')); const setStatus = (v) => { setStatusS(v); lsSet('ytos.read.status', v); };
  const [type, setTypeS] = useState(() => lsGet('ytos.read.type', 'all')); const setType = (v) => { setTypeS(v); lsSet('ytos.read.type', v); };
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [open, setOpen] = useState(null);
  const books = useMemo(() => {
    let l = s.books;
    if (status !== 'all') l = l.filter((b) => b.status === status);
    if (type !== 'all') l = l.filter((b) => b.type === type);
    if (q.trim()) { const k = q.toLowerCase(); l = l.filter((b) => (b.title + ' ' + b.author + ' ' + b.note + ' ' + b.tags.join(' ')).toLowerCase().includes(k)); }
    return l;
  }, [s.books, status, type, q]);
  const groups = useMemo(() => {
    if (status !== 'all') return [[STATUS.find(([v]) => v === status)[1], sortBy(books, '-created')]];
    return STATUS.map(([v, n]) => [n, sortBy(books.filter((b) => b.status === v), v === 'done' ? '-finished' : '-created')]).filter(([, l]) => l.length);
  }, [books, status]);
  const doneThisYear = s.books.filter((b) => b.status === 'done' && (b.finished || '').startsWith(todayStr().slice(0, 4))).length;
  const pct = (b) => (b.total ? (b.progress / b.total) * 100 : b.progress);
  const sel = open ? s.books.find((b) => b.id === open) : null;
  const bump = (b, n) => setProgress(b, b.progress + n);
  const setStatusOf = (b, v) => upsert('books', { id: b.id, status: v, ...(v === 'reading' && !b.started ? { started: todayStr() } : {}), ...(v === 'done' ? { finished: b.finished || todayStr(), progress: b.total || 100 } : {}) });
  const quickAdd = () => {
    const raw = quick.trim(); if (!raw) return;
    const m = raw.match(/^(.*?)(?:\s*[-–—]\s*|\s+by\s+|\s*·\s*|\s*\/\s*)(.+)$/);
    const nb = { id: uid(), title: m ? m[1].trim() : raw, author: m ? m[2].trim() : '', type: typesOf(s)[0][0], status: status === 'all' ? 'want' : status, progress: 0, total: 0, rating: 0, cover: '', link: '', note: '', tags: [], color: COLORS[s.books.length % COLORS.length], started: '', finished: '', created: todayStr() };
    upsert('books', nb); setQuick('');
    autoCover(nb, true); // 后台找封面，找不到就算了
  };
  const notePage = (b) => { const n = linkedPage('book:' + b.id, { title: b.title, nb: '读书笔记', color: '#7461c9', tags: ['读书', ...b.tags], body: `${b.author ? '作者：' + b.author + '\n\n' : ''}${b.note ? '> ' + b.note.replace(/\n/g, '\n> ') + '\n\n' : ''}## 摘录\n\n## 想法\n` }); go('notes/' + n.id); };
  const hasPage = (b) => s.notes.some((n) => n.ref === 'book:' + b.id);
  const menu = (b) => [{ label: '打开', icon: 'book', onClick: () => setOpen(b.id) }, b.status !== 'done' && { label: '让汤圆排阅读计划', icon: 'sparkle', hint: '拆成几次阅读', onClick: () => window.dispatchEvent(new CustomEvent('seal:breakdown', { detail: { src: { kind: 'book', id: b.id } } })) }, !b.cover && { label: '自动找封面', icon: 'image', onClick: () => autoCover(b) }, { label: hasPage(b) ? '打开笔记页' : '新建笔记页', icon: 'note', onClick: () => notePage(b) }, { label: '编辑', icon: 'edit', onClick: () => { setEditing(b); setModal(true); } }, 'sep', ...STATUS.map(([v, n]) => ({ label: n, icon: v === b.status ? 'check' : 'tag', onClick: () => setStatusOf(b, v) })), 'sep', b.link && { label: '打开链接', icon: 'external', onClick: () => window.open(b.link, '_blank', 'noopener') }, { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('books', b.id, b.title) }];

  // 这个月读了多少页（用每天记下的进度算）
  const monthPages = useMemo(() => { const m = todayStr().slice(0, 7); let n = 0; for (const b of s.books) { if (!(b.total > 0)) continue; const log = b.log || []; const before = [...log].reverse().find((x) => x.d < m + '-01'); const last = [...log].reverse().find((x) => x.d.startsWith(m)); if (last) n += Math.max(0, last.p - (before ? before.p : 0)); } return n; }, [s.books]);
  const reading = groups.find(([n]) => n === '在读');
  const shelves = groups.filter(([n]) => n !== '在读');
  const unit = (b) => (b.total > 0 ? '页' : '%');
  const tile = (b) => html`<div class="bk-tile" key=${b.id} ...${dragProps('book', { id: b.id })} onContextMenu=${(e) => ctxMenu(e, menu(b), b.title)}>
      <button type="button" class="bk-cv" style=${`--cc:${b.color || '#3b6fd6'}`} onClick=${() => setOpen(b.id)} title=${b.title}>${b.cover ? html`<img src=${b.cover} alt="" loading="lazy" />` : html`<span>${b.title.slice(0, 12)}</span>`}${b.status === 'reading' && html`<i class="bk-bar"><i style=${`width:${Math.min(100, pct(b))}%`}></i></i>`}</button>
      <b onClick=${() => setOpen(b.id)}>${b.title}</b>
      <small>${b.rating > 0 ? html`<${Stars} value=${b.rating} size=${10} />` : b.author || typeName(s, b.type)}</small>
    </div>`;
  const hero = (b) => { const pc = paceOf(b); return html`<div class="bk-hero" key=${b.id} ...${dragProps('book', { id: b.id })} onContextMenu=${(e) => ctxMenu(e, menu(b), b.title)}>
      <button type="button" class="bk-cv big" style=${`--cc:${b.color || '#3b6fd6'}`} onClick=${() => setOpen(b.id)}>${b.cover ? html`<img src=${b.cover} alt="" loading="lazy" />` : html`<span>${b.title.slice(0, 12)}</span>`}</button>
      <div class="bk-hero-b">
        <b class="bk-hero-t" onClick=${() => setOpen(b.id)}>${b.title}</b>
        <span class="bk-hero-a">${b.author || typeName(s, b.type)}${b.started ? ` · ${b.started.slice(5).replace('-', '/')} 开始` : ''}</span>
        <div class="bk-hero-p" onClick=${(e) => e.stopPropagation()}><${ProgressCtl} b=${b} /></div>
        <span class="bk-hero-pace">${pc && pc.read > 0 ? `最近每天约 ${pc.perDay.toFixed(pc.perDay < 10 ? 1 : 0)} ${unit(b)}${pc.eta ? ` · 预计 ${pc.eta.slice(5).replace('-', '/')} 读完` : ''}` : b.note ? `${b.note.slice(0, 40)}${b.note.length > 40 ? '…' : ''}` : '读一点就记一下进度，这里会算读速'}</span>
        <div class="bk-hero-act">
          ${(b.total > 0 ? [5, 10, 20] : [5, 10]).map((n) => html`<button type="button" class="bk-chip" onClick=${() => bump(b, n)}>+${n}${unit(b)}</button>`)}
          <span class="flex1"></span>
          ${pct(b) >= 100 ? html`<button type="button" class="btn sm primary" onClick=${() => setStatusOf(b, 'done')}>读完了</button>` : html`<button type="button" class="btn sm ghost" onClick=${() => setStatusOf(b, 'done')}>读完</button>`}
          <${IconBtn} icon="note" title=${hasPage(b) ? '打开笔记页' : '新建笔记页'} class=${'ibtn ' + (hasPage(b) ? 'on' : '')} size=${14} onClick=${() => notePage(b)} />
        </div>
      </div>
    </div>`; };

  return html`<div class="rd2">
    <div class="rd2-h">
      <div><h1>阅读</h1><p>${s.books.filter((b) => b.status === 'reading').length} 本在读 · 今年读完 ${doneThisYear} 本${monthPages ? ` · 本月读了 ${monthPages} 页` : ''}</p></div>
      <span class="flex1"></span>
      <div class="seg" data-liquid="button"><span class="liq"></span>${[{ v: 'all', label: '全部' }, ...STATUS.map(([v, n]) => ({ v, label: n }))].map((o) => html`<button type="button" class=${o.v === status ? 'on' : ''} onClick=${() => setStatus(o.v)} ...${o.v === 'all' ? {} : dropProps('book', (d) => { const bk = s.books.find((x) => x.id === d.id); if (bk) setStatusOf(bk, o.v); })}>${o.label}</button>`)}</div>
      <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>加入书架<//>
    </div>
    <div class="rd2-bar">
      <div class="quickadd flex1"><${Icon} name="book" size=${15} class="muted" /><input class="flex1" type="text" value=${quick} placeholder="书名 - 作者，回车快速加入（会自动找封面）" onInput=${(e) => setQuick(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && quickAdd()} /></div>
      <label class="rd2-search"><${Icon} name="search" size=${14} /><input type="search" value=${q} placeholder="搜书名、作者、笔记…" onInput=${(e) => setQ(e.target.value)} /></label>
    </div>
    <div class="filters">${[{ v: 'all', n: '所有类型' }, ...typesOf(s).map(([v, n]) => ({ v, n }))].map((t) => html`<${Tag} class=${'click ' + (type === t.v ? 'on' : '')} plain title="右键可重命名 / 删除 / 新建类型" onClick=${() => setType(t.v)} onContextMenu=${(e) => typeMenu(e, s, t.v === 'all' ? '' : t.v)}>${t.n}<//>`)}</div>
    ${books.length === 0 ? html`<div class="rd2-empty"><${Icon} name="book" size=${28} /><b>${s.books.length ? '没有匹配的书' : '书架还是空的'}</b><p>${s.books.length ? '换个筛选或搜索词试试。' : '在上面输入「书名 - 作者」回车，就放上书架了，封面会自动找。'}</p></div>`
      : html`
      ${reading && html`<section class="rd2-sec"><div class="rd2-sh">在读<span>${reading[1].length}</span></div><div class="bk-heros">${reading[1].map(hero)}</div></section>`}
      ${shelves.map(([name, list]) => html`<section class="rd2-sec" key=${name}><div class="rd2-sh">${name}<span>${list.length}</span></div><div class="bk-shelf">${list.map(tile)}</div></section>`)}`}
    <${BookModal} open=${modal} book=${editing} onClose=${() => setModal(false)} />
    <${Modal} open=${!!sel} onClose=${() => setOpen(null)} title=${sel?.title || ''} wide foot=${sel && html`<${Btn} kind="ghost" icon="edit" onClick=${() => { setEditing(sel); setModal(true); }}>编辑<//><${Btn} kind="ghost" icon="note" onClick=${() => { setOpen(null); notePage(sel); }}>${hasPage(sel) ? '打开笔记页' : '新建笔记页'}<//><span class="flex1"></span>${sel.link && html`<a class="btn" href=${sel.link} target="_blank" rel="noopener"><${Icon} name="external" size=${13} /> 打开链接</a>`}`}>
      ${sel && html`<div class="row" style="align-items:flex-start;gap:18px">
        <div class="cv" style=${`--cc:${sel.color || '#3b6fd6'}`}>${sel.cover ? html`<img src=${sel.cover} alt="" />` : sel.title.slice(0, 10)}</div>
        <div class="flex1">
          <div class="row wrap" style="gap:6px;margin-bottom:8px"><${Tag}>${typeName(s, sel.type)}<//><${Seg} options=${STATUS.map(([v, n]) => ({ v, label: n }))} value=${sel.status} onChange=${(v) => setStatusOf(sel, v)} /><${Stars} value=${sel.rating} onChange=${(v) => upsert('books', { id: sel.id, rating: v })} /></div>
          <div class="small muted">${sel.author}${sel.started ? ` · 开始 ${sel.started}` : ''}${sel.finished ? ` · 读完 ${sel.finished}` : ''}</div>
          <div style="margin-top:12px"><${ProgressCtl} b=${sel} /></div>
          ${(() => { const pc = paceOf(sel); const unit = sel.total > 0 ? '页' : '%'; const days = 14; const log = sel.log || []; const bars = Array.from({ length: days }, (_, i) => { const d = addDays(todayStr(), i - days + 1); const cur = log.filter((x) => x.d <= d).pop(); const prev = log.filter((x) => x.d < d).pop(); return { d, n: cur && cur.d === d ? Math.max(0, cur.p - (prev ? prev.p : 0)) : 0 }; }); const mx = Math.max(1, ...bars.map((x) => x.n));
            return html`<div class="pace">
              ${log.length >= 3 && html`<div class="pace-bars" title="最近 14 天每天读了多少">${bars.map((x) => html`<i key=${x.d} style=${`height:${Math.max(x.n ? 3 : 1, (x.n / mx) * 22)}px`} title=${`${x.d.slice(5)} · ${x.n} ${unit}`}></i>`)}</div>`}
              <div class="small muted">${pc && pc.read > 0 ? html`最近 ${pc.days} 天读了 <b>${pc.read}</b> ${unit} · 每天约 ${pc.perDay.toFixed(pc.perDay < 10 ? 1 : 0)} ${unit}${pc.eta ? html` · 照这个速度 <b>${pc.eta.slice(5).replace('-', '/')}</b> 读完` : pc.left <= 0 ? ' · 读完了' : ''}` : sel.status === 'reading' && log.length < 2 ? '多记几天进度，这里会显示读速和预计读完日' : ''}</div>
              ${pct(sel) >= 100 && sel.status !== 'done' && html`<${Btn} small kind="primary" onClick=${() => setStatusOf(sel, 'done')}>标记读完<//>`}
            </div>`; })()}
          <${Field} label="笔记" style="margin-top:14px"><textarea rows="8" value=${sel.note} placeholder="摘录、想法、读后感…" onInput=${(e) => upsert('books', { id: sel.id, note: e.target.value })}></textarea><//>
        </div>
      </div>`}
    <//>
  </div>`;
}
