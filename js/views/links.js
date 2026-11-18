import { html, useState, useMemo, useEffect } from '../../vendor/preact.js';
import { useStore, upsert, remove, update, removeUndo } from '../store.js';
import { Icon, IconBtn, Btn, Card, Modal, Field, Tag, Empty, Seg, TagInput, confirmDel } from '../ui.js';
import { uid, todayStr, hostOf, sortBy , lsGet, lsSet } from '../util.js';
import { ctxMenu } from '../ctx.js';
import { dragProps, dropProps } from '../dnd.js';
import { toast, go } from '../nav.js';
import { linkedPage } from './notes.js';

export function LinkModal({ open, link, onClose }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (open) setF(link ? { ...link } : { id: uid(), url: '', title: '', note: '', tags: [], fav: false, read: false, created: todayStr() }); }, [open, link]);
  if (!open || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = () => {
    let url = f.url.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    upsert('links', { ...f, url, host: hostOf(url), title: f.title.trim() || hostOf(url) });
    onClose();
  };
  return html`<${Modal} open=${open} onClose=${onClose} title=${link ? '编辑收藏' : '收藏链接'} foot=${html`
    ${link && html`<${Btn} kind="ghost danger" icon="trash" onClick=${() => { removeUndo('links', link.id, link.title || link.place || link.url); onClose(); }}>删除<//>`}
    <span class="flex1"></span><${Btn} kind="ghost" onClick=${onClose}>取消<//><${Btn} kind="primary" icon="check" onClick=${save}>保存<//>`}>
    <div class="form">
      <${Field} label="URL"><input type="url" autofocus value=${f.url} placeholder="https://…" onInput=${(e) => set('url', e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /><//>
      <${Field} label="标题"><input type="text" value=${f.title} placeholder="留空则用域名" onInput=${(e) => set('title', e.target.value)} /><//>
      <${Field} label="标签"><${TagInput} value=${f.tags} onChange=${(v) => set('tags', v)} /><//>
      <${Field} label="为什么收藏 / 摘要"><textarea rows="3" value=${f.note} onInput=${(e) => set('note', e.target.value)}></textarea><//>
    </div>
  <//>`;
}

// 存储里的 URL 只放行 http(s)（导入 / 同步来的文档不可信）
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : '#');
export default function Links({ route }) {
  const s = useStore();
  useEffect(() => { const id = route && route.query && route.query.open; const l = id && s.links.find((x) => x.id === id); if (l) { setEditing(l); setModal(true); } }, [route && route.query && route.query.open]);
  const [q, setQ] = useState('');
  const [tagF, setTagF] = useState('');
  const [view, setViewS] = useState(() => lsGet('ytos.links.view', 'all')); const setView = (v) => { setViewS(v); lsSet('ytos.links.view', v); };
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(false);
  const [quick, setQuick] = useState('');
  const links = useMemo(() => {
    let l = s.links;
    if (view === 'fav') l = l.filter((x) => x.fav);
    if (tagF) l = l.filter((x) => x.tags.includes(tagF));
    if (q) { const k = q.toLowerCase(); l = l.filter((x) => (x.title + x.url + x.note + x.tags.join(' ')).toLowerCase().includes(k)); }
    return l;
  }, [s.links, view, tagF, q]);
  const tags = useMemo(() => { const m = new Map(); s.links.forEach((l) => l.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [s.links]);
  const quickAdd = () => {
    let url = quick.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    upsert('links', { id: uid(), url, host: hostOf(url), title: hostOf(url), note: '', tags: tagF ? [tagF] : [], fav: false, read: false, created: todayStr() });
    setQuick('');
  };
  const groups = useMemo(() => {
    const g = new Map();
    links.forEach((l) => { const k = l.created.slice(0, 7); if (!g.has(k)) g.set(k, []); g.get(k).push(l); });
    return [...g.entries()];
  }, [links]);

  // 每个网站一个固定的颜色（卡片顶上那条色带）
  const hue = (h) => { let n = 0; for (const c of String(h || '')) n = (n * 31 + c.charCodeAt(0)) >>> 0; return n % 360; };
  const toNote = (l) => { const n = linkedPage('link:' + l.id, { title: l.title, nb: '收件箱', tags: l.tags, body: `[${l.title}](${l.url})\n\n${l.note ? '> ' + l.note.replace(/\n/g, '\n> ') + '\n\n' : ''}## 要点\n\n## 我的想法\n` }); go('notes/' + n.id); };
  const hasNote = (l) => s.notes.some((n) => n.ref === 'link:' + l.id);
  const card = (l) => html`<article class="lk-card" key=${l.id} style=${`--h:${hue(l.host)}`} ...${dragProps('link', { id: l.id })} onContextMenu=${(e) => ctxMenu(e, [{ label: '打开链接', icon: 'external', onClick: () => window.open(safeUrl(l.url), '_blank', 'noopener') }, { label: hasNote(l) ? '打开笔记' : '转成笔记', icon: 'note', onClick: () => toNote(l) }, { label: l.fav ? '取消最爱' : '设为最爱', icon: 'heart', onClick: () => upsert('links', { id: l.id, fav: !l.fav }) }, { label: '编辑', icon: 'edit', onClick: () => { setEditing(l); setModal(true); } }, 'sep', { label: '删除', icon: 'trash', danger: true, onClick: () => removeUndo('links', l.id, l.title) }], l.title)}>
      <a class="lk-top" href=${safeUrl(l.url)} target="_blank" rel="noopener">
        <span class="lk-ic"><img referrerpolicy="no-referrer" src=${`https://www.google.com/s2/favicons?domain=${encodeURIComponent(l.host || '')}&sz=64`} alt="" onError=${(e) => { e.target.replaceWith(document.createTextNode((l.host || '?')[0].toUpperCase())); }} /></span>
        <span class="lk-host">${l.host}</span>
      </a>
      <a class="lk-t" href=${safeUrl(l.url)} target="_blank" rel="noopener">${l.title}</a>
      ${l.note && html`<p class="lk-n">${l.note}</p>`}
      ${l.tags.length > 0 && html`<div class="lk-tags">${l.tags.map((t) => html`<button type="button" class="lk-tag" onClick=${() => setTagF(t)}>#${t}</button>`)}</div>`}
      <div class="lk-f">
        <span>${l.created.slice(5).replace('-', '/')}</span><span class="flex1"></span>
        <button type="button" class=${'lk-b' + (hasNote(l) ? ' on' : '')} title=${hasNote(l) ? '打开笔记' : '转成笔记：记下要点和想法'} onClick=${() => toNote(l)}><${Icon} name="note" size=${14} /></button>
        <button type="button" class=${'lk-b heart' + (l.fav ? ' on' : '')} title="最爱" onClick=${() => upsert('links', { id: l.id, fav: !l.fav })}><${Icon} name="heart" size=${14} /></button>
        <button type="button" class="lk-b" title="编辑" onClick=${() => { setEditing(l); setModal(true); }}><${Icon} name="edit" size=${13} /></button>
      </div>
    </article>`;
  const rest = links;
  const restGroups = useMemo(() => { const g = new Map(); rest.forEach((l) => { const k = l.created.slice(0, 7); if (!g.has(k)) g.set(k, []); g.get(k).push(l); }); return [...g.entries()]; }, [rest]);

  return html`<div class="rd2 lk2">
    <div class="lk2-h">
      <div><h1>收藏</h1><p>${s.links.length} 条${s.links.some((l) => l.fav) ? ` · ${s.links.filter((l) => l.fav).length} 条最爱` : ''}</p></div>
      <span class="flex1"></span>
      <${Seg} options=${[{ v: 'all', label: '全部' }, { v: 'fav', label: '最爱' }]} value=${view === 'unread' ? 'all' : view} onChange=${setView} />
      <${Btn} kind="primary" icon="plus" onClick=${() => { setEditing(null); setModal(true); }}>收藏<//>
    </div>
    <div class="lk2-bar">
      <div class="quickadd flex1"><${Icon} name="link" size=${15} class="muted" /><input class="flex1" type="text" value=${quick} placeholder="粘贴链接，回车就收藏好了" onInput=${(e) => setQuick(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && quickAdd()} /></div>
      <label class="rd2-search"><${Icon} name="search" size=${14} /><input type="search" value=${q} placeholder="搜标题、网址、备注…" onInput=${(e) => setQ(e.target.value)} /></label>
    </div>
    ${tags.length > 0 && html`<div class="filters">${tags.map(([t, n]) => html`<${Tag} class=${'click ' + (tagF === t ? 'on' : '')} onClick=${() => setTagF(tagF === t ? '' : t)} ...${dropProps('link', (d) => { const l = s.links.find((x) => x.id === d.id); if (l && !l.tags.includes(t)) upsert('links', { id: l.id, tags: [...l.tags, t] }); })}>${t} <span class="muted">${n}</span><//>`)}</div>`}
    ${links.length === 0 ? html`<div class="lk2-empty"><${Icon} name="link" size=${28} /><b>${s.links.length ? '没有匹配的收藏' : '还没有收藏'}</b><p>${s.links.length ? '换个筛选或搜索词试试。' : '把链接粘贴到上面的输入框，回车就收藏好了，也可以一键转成笔记。'}</p></div>`
      : html`
      ${restGroups.map(([mon, list]) => html`<section class="rd2-sec" key=${mon}><div class="rd2-sh">${Number(mon.slice(0, 4))}年${Number(mon.slice(5))}月<span>${list.length}</span></div><div class="lk-grid">${list.map(card)}</div></section>`)}`}
    <${LinkModal} open=${modal} link=${editing} onClose=${() => setModal(false)} />
  </div>`;
}
