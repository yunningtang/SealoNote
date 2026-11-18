// 「今天」：左边是这天要做的事，右边是几天的日历。把左边的待办拖到右边某天某个时间，就排进去了。
// 侧栏「今天」打开这里；#/today?d=2026-11-20 直接看那天。
import { html, useState, useMemo, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, upsert, remove, get } from '../store.js';
import { Icon, IconBtn, Btn, Seg, Collapse, Empty } from '../ui.js';
import { todayStr, addDays, parseDate, WEEKDAY, sortBy, lsGet, lsSet, timeToMin, pad, PRIORITY } from '../util.js';
import { onDay, isDropped } from '../remind.js';
import { TodoItem, TodoModal, QuickAdd, moveOverdueToday } from './todos.js';
import { Timeline, BlockModal } from './planner.js';
import { dragProps } from '../dnd.js';
import { scheduleTodo } from '../schedule.js';

const HOUR_H = 52;
const wd = (d) => WEEKDAY[(parseDate(d).getDay() + 6) % 7];
const dayLabel = (d) => { const t = todayStr(); return d === t ? '今天' : d === addDays(t, 1) ? '明天' : d === addDays(t, -1) ? '昨天' : `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`; };

function Section({ title, n, open, onToggle, act, children }) {
  return html`<div class="td-sec">
    <div class="td-sec-h"><button type="button" class="td-sec-t" onClick=${onToggle}><${Icon} name="right" size=${11} class=${open ? 'rot' : ''} />${title}<span>${n}</span></button>${act}</div>
    <${Collapse} open=${open}>${children}<//>
  </div>`;
}

// 一条可以拖进日历的待办；time：已经排进日历的那一段时间
function Row({ t, onEdit, time, onUnplan, day }) {
  // 写了时间但还没在日历上：一键按那个时间排进去
  const at = !time && !t.done && day && t.time && t.due === day;
  return html`<div class="td-row" key=${t.id} ...${dragProps('todo', { id: t.id })} title="拖到日历里排时间">
    <${TodoItem} t=${t} compact onEdit=${onEdit} />
    ${at && html`<button type="button" class="td-put" title=${`从 ${t.time} 开始找空档放进日历`} onClick=${() => scheduleTodo(t, day, { exact: true })}><${Icon} name="calendar" size=${11} />排进日历</button>`}
    ${time && html`<span class="td-when"><${Icon} name="calendar" size=${10} />${time}${onUnplan && html`<button type="button" title="从日历上拿掉（待办还在）" onClick=${onUnplan}><${Icon} name="x" size=${10} /></button>`}</span>`}
  </div>`;
}

export default function TodayView({ route } = {}) {
  const s = useStore();
  const today = todayStr();
  const q = route && route.query && /^\d{4}-\d\d-\d\d$/.test(route.query.d || '') ? route.query.d : '';
  const [day, setDay] = useState(q || today); // 左边列表看的是哪天
  const [nPick, setN] = useState(() => Number(lsGet('td.days', '3')) || 3); // 右边显示几天
  const [from, setFrom] = useState(q || today); // 右边从哪天开始
  const [open, setOpen] = useState(() => { try { return { late: true, todo: true, cal: true, done: false, inbox: false, ...JSON.parse(lsGet('td.open', '{}')) }; } catch { return { late: true, todo: true, cal: true, done: false, inbox: false }; } });
  const tog = (k) => { const v = { ...open, [k]: !open[k] }; setOpen(v); lsSet('td.open', JSON.stringify(v)); };
  const [tEdit, setTEdit] = useState(null);
  const [blk, setBlk] = useState(null); // { block } | { date, start, kind }

  // 左边：这天的待办分成「没排时间 / 已在日历上 / 做完了」，今天再加上「逾期」和「收件箱（没日期）」
  const L = useMemo(() => {
    const on = s.todos.filter((t) => onDay(t, day));
    const planned = new Map(); // todoId → 'HH:MM–HH:MM'
    for (const b of sortBy(s.blocks.filter((b) => b.date === day && b.todoId && b.start && b.end), 'start')) if (!planned.has(b.todoId)) planned.set(b.todoId, `${b.start}–${b.end}`);
    const open_ = sortBy(on.filter((t) => !t.done), 'priority', 'time');
    return {
      todo: open_.filter((t) => !planned.has(t.id)),
      cal: open_.filter((t) => planned.has(t.id)).sort((a, b) => (planned.get(a.id) < planned.get(b.id) ? -1 : 1)),
      done: on.filter((t) => t.done && !isDropped(t)),
      late: day === today ? sortBy(s.todos.filter((t) => !t.done && t.due && (t.dueEnd || t.due) < today), 'due', 'priority') : [],
      inbox: sortBy(s.todos.filter((t) => !t.done && !t.due), 'priority', '-created'),
      planned,
    };
  }, [s.todos, s.blocks, day, today]);
  // 一句话：这天排了多少时间、还剩几件没排
  const sumLine = useMemo(() => {
    const mins = s.blocks.filter((b) => b.date === day && !b.pomo && b.kind !== 'check' && b.start && b.end).reduce((n, b) => n + Math.max(0, timeToMin(b.end) - timeToMin(b.start)), 0);
    const h = mins / 60; const parts = [mins ? `已排 ${h % 1 ? h.toFixed(1) : h} 小时` : '日历上还空着'];
    if (L.todo.length) parts.push(`${L.todo.length} 件还没排`); else if (L.cal.length) parts.push('待办都排好了');
    if (L.done.length) parts.push(`做完 ${L.done.length} 件`);
    return parts.join(' · ');
  }, [s.blocks, day, L]);
  const unplan = (t) => { const ids = get().blocks.filter((b) => b.date === day && b.todoId === t.id).map((b) => b.id); ids.forEach((id) => remove('blocks', id)); upsert('todos', { id: t.id, time: '' }); };

  // 右边：n 天，每天一条时间线，共用左边的小时刻度
  // 手机上最多 3 天，再多每列就挤得看不清了
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches);
  useEffect(() => { if (typeof matchMedia !== 'function') return; const m = matchMedia('(max-width: 700px)'); const h = () => setNarrow(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  const n = narrow ? Math.min(nPick, 3) : nPick;
  const days = Array.from({ length: n }, (_, i) => addDays(from, i));
  const byDay = useMemo(() => { const m = {}; for (const d of days) m[d] = sortBy(s.blocks.filter((b) => b.date === d && !b.pomo), 'start'); return m; }, [s.blocks, from, n]);
  const counts = useMemo(() => { const m = {}; for (const d of days) m[d] = s.todos.filter((t) => !t.done && onDay(t, d)).length; return m; }, [s.todos, from, n]);
  // 每天还没排进日历的待办（日历顶上那一行，可以直接往下拖）
  const loose = useMemo(() => { const m = {}; for (const d of days) { const on = new Set(s.blocks.filter((b) => b.date === d && b.todoId).map((b) => b.todoId)); m[d] = sortBy(s.todos.filter((t) => !t.done && onDay(t, d) && !on.has(t.id)), 'priority', 'time'); } return m; }, [s.todos, s.blocks, from, n]);
  const scRef = useRef();
  useEffect(() => { const el = scRef.current; if (!el) return; const now = new Date(); el.scrollTop = Math.max(0, ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H - el.clientHeight * 0.3); }, []);
  const setDays = (v) => { setN(v); lsSet('td.days', String(v)); };
  const ym = parseDate(from);

  return html`<div class="td" style=${`--cols:${n}`}>
    <section class="td-list">
      <div class="td-head">
        <h2>${dayLabel(day)}</h2>
        <div class="td-date">
          <${IconBtn} icon="left" size=${13} title="前一天" onClick=${() => setDay(addDays(day, -1))} />
          <span>${wd(day)}，${Number(day.slice(5, 7))}月${Number(day.slice(8))}日</span>
          <${IconBtn} icon="right" size=${13} title="后一天" onClick=${() => setDay(addDays(day, 1))} />
          ${day !== today && html`<button type="button" class="td-back" onClick=${() => setDay(today)}>回到今天</button>`}
        </div>
      </div>
      <div class="td-sum">${sumLine}</div>
      <${QuickAdd} key=${day} defaults=${{ due: day }} placeholder=${`给${dayLabel(day)}加一件事…（回车）`} />
      <div class="td-scroll">
        ${L.late.length > 0 && html`<${Section} title="逾期" n=${L.late.length} open=${open.late} onToggle=${() => tog('late')} act=${html`<button type="button" class="td-act" onClick=${() => moveOverdueToday(L.late)}>全部挪到今天</button>`}>
          ${L.late.map((t) => html`<${Row} key=${t.id} t=${t} onEdit=${setTEdit} />`)}
        <//>`}
        <${Section} title="待办" n=${L.todo.length} open=${open.todo} onToggle=${() => tog('todo')}>
          ${L.todo.length ? L.todo.map((t) => html`<${Row} key=${t.id} t=${t} day=${day} onEdit=${setTEdit} />`) : html`<p class="td-empty">${L.cal.length || L.done.length ? '都排好了 ✓' : '这天还没有待办，上面加一件吧'}</p>`}
        <//>
        ${L.cal.length > 0 && html`<${Section} title="已在日历上" n=${L.cal.length} open=${open.cal} onToggle=${() => tog('cal')}>
          ${L.cal.map((t) => html`<${Row} key=${t.id} t=${t} onEdit=${setTEdit} time=${L.planned.get(t.id)} onUnplan=${() => unplan(t)} />`)}
        <//>`}
        ${L.done.length > 0 && html`<${Section} title="已完成" n=${L.done.length} open=${open.done} onToggle=${() => tog('done')}>
          ${L.done.map((t) => html`<${Row} key=${t.id} t=${t} onEdit=${setTEdit} />`)}
        <//>`}
        ${L.inbox.length > 0 && html`<${Section} title="收件箱 · 没定日期" n=${L.inbox.length} open=${open.inbox} onToggle=${() => tog('inbox')}>
          ${L.inbox.map((t) => html`<${Row} key=${t.id} t=${t} onEdit=${setTEdit} />`)}
        <//>`}
        <p class="td-tip"><${Icon} name="cursor" size=${11} />${narrow ? '把待办拖到下面的日历上就排好时间了' : '把待办拖到右边的日历上就排好时间了；日历里的块也能拖到别的天'}</p>
      </div>
    </section>

    <section class="td-cal">
      <div class="td-cal-h">
        <b>${ym.getFullYear()}年${ym.getMonth() + 1}月</b>
        <div class="td-nav">
          <${IconBtn} icon="left" size=${14} title=${`往前 ${n} 天`} onClick=${() => setFrom(addDays(from, -n))} />
          <${Btn} small kind="ghost" disabled=${from === today} onClick=${() => { setFrom(today); setDay(today); }}>今天<//>
          <${IconBtn} icon="right" size=${14} title=${`往后 ${n} 天`} onClick=${() => setFrom(addDays(from, n))} />
        </div>
        <${Seg} value=${n} onChange=${setDays} options=${[{ v: 1, label: '1 天' }, { v: 3, label: '3 天' }, ...(narrow ? [] : [{ v: 5, label: '5 天' }, { v: 7, label: '7 天' }])]} />
      </div>
      <div class="td-days">
        <span class="td-gut"></span>
        ${days.map((d) => html`<button type="button" key=${d} class=${'td-day' + (d === today ? ' today' : '') + (d === day ? ' sel' : '')} title="在左边看这天的待办" onClick=${() => setDay(d)}>
          <small>${wd(d)}</small><b>${Number(d.slice(8))}</b>${counts[d] > 0 && html`<i>${counts[d]}</i>`}
        </button>`)}
      </div>
      <div class="td-allday">
        <span class="td-gut">待排</span>
        ${days.map((d) => { const list = loose[d] || []; return html`<div key=${d} class="td-ad">${list.slice(0, 3).map((t) => html`<div class="td-chip" style=${`--pc:${(PRIORITY[t.priority] || PRIORITY[2]).color}`} key=${t.id} ...${dragProps('todo', { id: t.id })} title=${`${t.title}${t.time ? ' · ' + t.time : ''}（拖到下面排时间）`} onClick=${() => setTEdit(t)}>${t.title}</div>`)}${list.length > 3 && html`<button type="button" class="td-more" onClick=${() => setDay(d)}>还有 ${list.length - 3} 件</button>`}</div>`; })}
      </div>
      <div class="td-body" ref=${scRef}>
        <div class="td-grid">
          <div class="td-gut">${Array.from({ length: 24 }, (_, h) => html`<div style=${`height:${HOUR_H}px`}><span>${h ? pad(h) + ':00' : ''}</span></div>`)}</div>
          ${days.map((d) => html`<div key=${d} class=${'td-col' + (d === today ? ' today' : '')}>
            <${Timeline} date=${d} blocks=${byDay[d]} hourH=${HOUR_H} onEdit=${(b) => setBlk({ block: b })} onCreate=${(start, kind) => setBlk({ date: d, start, kind: kind || '' })} />
          </div>`)}
        </div>
      </div>
    </section>
    <${TodoModal} open=${!!tEdit} todo=${tEdit} onClose=${() => setTEdit(null)} />
    <${BlockModal} open=${!!blk} block=${blk && blk.block} date=${blk && (blk.date || (blk.block && blk.block.date))} start=${(blk && blk.start) || '09:00'} kind=${(blk && blk.kind) || ''} onClose=${() => setBlk(null)} />
  </div>`;
}
