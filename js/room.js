// 汤圆的房间：一间画出来的小卧室（像玩具屋剖面），汤圆坐在里面。
//  · 家具、墙上的东西、小物件都可以拖到任何位置；拖回下面的抽屉或右键就是拿走
//  · 墙纸、地板可以换
//  · 有点活气：钟走的是真实时间，窗外白天 / 晚上跟着现在几点，天黑了台灯会亮；番茄钟在走时汤圆坐到书桌前
//  · 东西一件件解锁：每完成几轮专注（10 分钟以上算一轮）解锁一件，开局就有几件基础的
// 存在 settings.pet.room，跟着账号同步。
import { html, useState, useRef, useEffect } from '../vendor/preact.js';
import { update, get } from './store.js';

export const W = 360, H = 260, FLOOR = 178; // 房间画布：上面是墙，FLOOR 以下是地板

export const WALLS = [['cream', '奶油', '#f6eedf', '#efe3cc'], ['mint', '薄荷', '#e3f1ea', '#d2e8dc'], ['sky', '天蓝', '#e2edf8', '#d0e1f2'], ['peach', '蜜桃', '#fae6dc', '#f4d5c6'], ['stripe', '条纹', '#f4efe6', '#e8dfcf'], ['dots', '圆点', '#f0eef7', '#e2def0']];
export const FLOORS = [['wood', '木地板', '#d8b48a', '#c99f72'], ['carpet', '地毯', '#c9b9d6', '#bba9ca'], ['tile', '瓷砖', '#e6e6e2', '#d6d6d1']];

// 每件东西：k、名字、放哪（wall 墙上 / floor 地上）、大小、要完成几轮专注才解锁、怎么画（SVG，原点在左上角）
const night = () => { const h = new Date().getHours(); return h >= 19 || h < 6; };
export const ITEMS = [
  { k: 'bed', name: '小床', at: 'floor', w: 110, h: 62, need: 0, draw: () => html`<rect x="4" y="22" width="102" height="30" rx="6" fill="#f2a7b8"/><rect x="0" y="6" width="14" height="52" rx="5" fill="#b98a5e"/><rect x="96" y="20" width="14" height="38" rx="5" fill="#b98a5e"/><rect x="16" y="16" width="30" height="14" rx="6" fill="#fff"/><path d="M14 30 H106 V44 H14 Z" fill="#e48aa0"/><rect x="0" y="56" width="110" height="6" rx="3" fill="#9c7049"/>` },
  { k: 'rug', name: '圆地毯', at: 'floor', w: 120, h: 26, need: 0, draw: () => html`<ellipse cx="60" cy="13" rx="60" ry="13" fill="#9cc3f5"/><ellipse cx="60" cy="13" rx="44" ry="9" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 4" opacity=".8"/>` },
  { k: 'window', name: '窗户', at: 'wall', w: 72, h: 62, need: 0, draw: () => { const n = night(); return html`<rect x="0" y="0" width="72" height="62" rx="5" fill="#fff"/><rect x="5" y="5" width="62" height="52" rx="3" fill=${n ? '#25335a' : '#bfe3ff'}/>${n ? html`<circle cx="50" cy="18" r="7" fill="#f6e7a8"/><circle cx="18" cy="14" r="1.5" fill="#fff"/><circle cx="30" cy="30" r="1.2" fill="#fff"/>` : html`<circle cx="52" cy="16" r="8" fill="#ffd66b"/><path d="M10 44 Q22 34 34 44 T60 44 V57 H10 Z" fill="#9fd39a"/>`}<path d="M36 5 V57 M5 31 H67" stroke="#fff" stroke-width="4"/><rect x="-4" y="58" width="80" height="6" rx="3" fill="#e3d2bc"/>`; } },
  { k: 'desk', name: '书桌', at: 'floor', w: 86, h: 56, need: 0, draw: () => html`<rect x="0" y="0" width="86" height="8" rx="3" fill="#b98a5e"/><rect x="6" y="8" width="6" height="48" fill="#9c7049"/><rect x="74" y="8" width="6" height="48" fill="#9c7049"/><rect x="48" y="10" width="26" height="22" rx="2" fill="#c99f72"/><circle cx="61" cy="21" r="2" fill="#7a5638"/>` },
  { k: 'plant', name: '盆栽', at: 'floor', w: 32, h: 46, need: 0, draw: () => html`<path d="M16 26 C2 20 2 6 10 2 C12 12 16 16 16 26 C16 16 20 10 26 4 C32 12 28 22 16 26" fill="#5c9a52"/><path d="M6 26 H26 L23 46 H9 Z" fill="#d98a5f"/>` },
  { k: 'lamp', name: '台灯', at: 'floor', w: 30, h: 58, need: 0, draw: () => { const n = night(); return html`${n && html`<ellipse cx="15" cy="20" rx="26" ry="20" fill="#ffe7a3" opacity=".45"/>`}<path d="M4 18 L10 2 H20 L26 18 Z" fill=${n ? '#ffe28a' : '#f6cf63'}/><rect x="13" y="18" width="4" height="34" fill="#6b6f78"/><rect x="5" y="52" width="20" height="6" rx="3" fill="#6b6f78"/>`; } },
  { k: 'clock', name: '挂钟', at: 'wall', w: 34, h: 34, need: 0, draw: () => { const d = new Date(); const m = d.getMinutes(), h = (d.getHours() % 12) + m / 60; const hand = (deg, len) => { const a = (deg - 90) * Math.PI / 180; return `M17 17 L${17 + Math.cos(a) * len} ${17 + Math.sin(a) * len}`; }; return html`<circle cx="17" cy="17" r="16" fill="#fff" stroke="#c99f72" stroke-width="3"/><path d=${hand(h * 30, 7)} stroke="#1f1e1c" stroke-width="2.4" stroke-linecap="round"/><path d=${hand(m * 6, 11)} stroke="#1f1e1c" stroke-width="1.6" stroke-linecap="round"/><circle cx="17" cy="17" r="1.8" fill="#d2524f"/>`; } },
  { k: 'poster', name: '海豹海报', at: 'wall', w: 42, h: 54, need: 2, draw: () => html`<rect x="0" y="0" width="42" height="54" rx="2" fill="#fff" stroke="#e3d2bc" stroke-width="2"/><rect x="4" y="4" width="34" height="38" fill="#cfe6f7"/><ellipse cx="21" cy="30" rx="11" ry="9" fill="#fff"/><circle cx="17" cy="28" r="1.4" fill="#222"/><circle cx="25" cy="28" r="1.4" fill="#222"/><rect x="8" y="46" width="26" height="3" rx="1.5" fill="#d8cdbb"/>` },
  { k: 'mug', name: '马克杯', at: 'floor', w: 18, h: 18, need: 2, draw: () => html`<rect x="2" y="4" width="12" height="14" rx="2" fill="#e8eef9"/><path d="M14 8 C19 8 19 15 14 15" stroke="#e8eef9" stroke-width="2.5" fill="none"/><path d="M6 1 C5 3 9 3 8 5" stroke="#bbb" fill="none"/>` },
  { k: 'shelf', name: '书架', at: 'floor', w: 60, h: 92, need: 4, draw: () => html`<rect x="0" y="0" width="60" height="92" rx="3" fill="#b98a5e"/><rect x="5" y="5" width="50" height="24" fill="#8a6440"/><rect x="5" y="34" width="50" height="24" fill="#8a6440"/><rect x="5" y="63" width="50" height="24" fill="#8a6440"/>${[['#d2524f', 8], ['#4f7cf5', 15], ['#f6cf63', 22], ['#4a9a6a', 29]].map(([c, x]) => html`<rect x=${x} y="9" width="6" height="20" fill=${c}/>`)}${[['#8a63c9', 10], ['#e0894f', 17]].map(([c, x]) => html`<rect x=${x} y="38" width="6" height="20" fill=${c}/>`)}<circle cx="44" cy="51" r="6" fill="#5c9a52"/><rect x="8" y="78" width="20" height="9" fill="#e48aa0"/>` },
  { k: 'books', name: '一摞书', at: 'floor', w: 38, h: 24, need: 4, draw: () => html`<rect x="2" y="16" width="34" height="8" rx="1" fill="#4f7cf5"/><rect x="5" y="8" width="28" height="8" rx="1" fill="#d2524f"/><rect x="3" y="0" width="30" height="8" rx="1" fill="#f6cf63"/>` },
  { k: 'beanbag', name: '懒人沙发', at: 'floor', w: 56, h: 40, need: 6, draw: () => html`<path d="M4 38 C-2 20 10 2 28 2 C46 2 58 20 52 38 Z" fill="#e0894f"/><path d="M12 26 C20 20 36 20 44 26" stroke="#c96f38" stroke-width="2" fill="none"/>` },
  { k: 'wallshelf', name: '小壁架', at: 'wall', w: 72, h: 32, need: 6, draw: () => html`<rect x="0" y="24" width="72" height="6" rx="2" fill="#b98a5e"/><path d="M8 24 C2 18 6 8 12 6 C14 14 14 18 12 24" fill="#5c9a52"/><rect x="6" y="16" width="10" height="8" fill="#d98a5f"/><rect x="30" y="10" width="7" height="14" fill="#4f7cf5"/><rect x="38" y="12" width="7" height="12" fill="#f6cf63"/><circle cx="60" cy="18" r="6" fill="#f2a7b8"/>` },
  { k: 'lights', name: '星星灯', at: 'wall', w: 130, h: 22, need: 8, draw: () => html`<path d="M0 4 Q65 26 130 4" stroke="#8a8f98" stroke-width="1.2" fill="none"/>${[10, 30, 50, 70, 90, 110].map((x, i) => { const y = 4 + Math.sin((x / 130) * Math.PI) * 12; return html`<circle cx=${x} cy=${y + 4} r="3.5" fill=${['#f6cf63', '#f2a7b8', '#9cc3f5'][i % 3]} opacity=${night() ? 1 : .85}/>`; })}` },
  { k: 'poster2', name: '山的海报', at: 'wall', w: 58, h: 42, need: 8, draw: () => html`<rect x="0" y="0" width="58" height="42" rx="2" fill="#fff" stroke="#e3d2bc" stroke-width="2"/><rect x="4" y="4" width="50" height="34" fill="#ffe7cf"/><path d="M4 38 L20 16 L30 28 L38 18 L54 38 Z" fill="#6aa85a"/><circle cx="44" cy="12" r="4" fill="#e0894f"/>` },
  { k: 'tank', name: '鱼缸', at: 'floor', w: 56, h: 40, need: 12, draw: () => html`<rect x="0" y="4" width="56" height="34" rx="5" fill="#bfe3ff" opacity=".85" stroke="#9cc3f5" stroke-width="2"/><path d="M14 22 l8 -4 v8 z M22 22 c3 -4 9 -4 10 0 c-1 4 -7 4 -10 0" fill="#e0894f"/><path d="M40 36 C38 28 44 26 42 18" stroke="#5c9a52" stroke-width="2" fill="none"/><rect x="-2" y="36" width="60" height="4" rx="2" fill="#6b6f78"/>` },
  { k: 'catpillow', name: '猫咪抱枕', at: 'floor', w: 42, h: 30, need: 16, draw: () => html`<path d="M4 30 C0 16 4 6 8 2 L14 10 H28 L34 2 C38 6 42 16 38 30 Z" fill="#f6eedf" stroke="#e3d2bc" stroke-width="1.5"/><circle cx="16" cy="18" r="1.6" fill="#222"/><circle cx="26" cy="18" r="1.6" fill="#222"/><path d="M19 22 Q21 24 23 22" stroke="#222" fill="none"/>` },
];
const ITEM = Object.fromEntries(ITEMS.map((x) => [x.k, x]));

// 完成了几轮专注（10 分钟以上算一轮）：解锁家具用
export const focusRounds = (s = get()) => (s.sessions || []).filter((x) => (x.mins || 0) >= 10).length;
export const unlocked = (it, rounds) => rounds >= (it.need || 0);

export const DEFAULT_ROOM = { wall: 'cream', floor: 'wood', items: [{ id: 'w1', k: 'window', x: 140, y: 34 }, { id: 'b1', k: 'bed', x: 22, y: 150 }, { id: 'r1', k: 'rug', x: 160, y: 214 }, { id: 'p1', k: 'plant', x: 300, y: 154 }] };
export const roomOf = (s) => { const r = (s && s.settings && s.settings.pet && s.settings.pet.room) || null; return r && Array.isArray(r.items) ? r : DEFAULT_ROOM; };
export const setRoom = (fn) => update((d) => { const pet = d.settings.pet = d.settings.pet || {}; const cur = JSON.parse(JSON.stringify(roomOf(d))); pet.room = fn(cur) || cur; });

const clampItem = (it, x, y) => {
  const def = ITEM[it.k]; if (!def) return { x, y };
  const minY = def.at === 'wall' ? 6 : FLOOR - def.h + 6, maxY = def.at === 'wall' ? FLOOR - def.h - 6 : H - def.h - 2;
  return { x: Math.round(Math.max(0, Math.min(W - def.w, x))), y: Math.round(Math.max(minY, Math.min(maxY, y))) };
};

// 汤圆坐在哪：番茄钟在走、房间里有书桌就坐到书桌前，不然坐在地毯上（没有地毯就在房间中间）
export function sealSpot(room, working) {
  const desk = working && room.items.find((x) => x.k === 'desk'); if (desk) return { x: desk.x + ITEM.desk.w / 2, y: desk.y + 48 };
  const rug = room.items.find((x) => x.k === 'rug'); if (rug) return { x: rug.x + ITEM.rug.w / 2, y: rug.y + 16 };
  return { x: W / 2, y: H - 20 };
}

// 房间本身。edit：可以拖东西、右键拿走。children：汤圆（3D 画布），会放在 sealAt 那个位置
export function Room({ room, edit = false, sealAt, children, onChange }) {
  const svg = useRef(); const [drag, setDrag] = useState(null); const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30e3); return () => clearInterval(t); }, []); // 钟和窗外跟着时间走
  const wall = WALLS.find((w) => w[0] === room.wall) || WALLS[0]; const floor = FLOORS.find((f) => f[0] === room.floor) || FLOORS[0];
  const toLocal = (e) => { const r = svg.current.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const down = (e, it) => { if (!edit || e.button !== 0) return; e.stopPropagation(); e.preventDefault(); const [x, y] = toLocal(e); svg.current.setPointerCapture(e.pointerId); setDrag({ id: it.id, dx: x - it.x, dy: y - it.y, x: it.x, y: it.y }); };
  const move = (e) => { if (!drag) return; const [x, y] = toLocal(e); const it = room.items.find((i) => i.id === drag.id); const p = clampItem(it, x - drag.dx, y - drag.dy); setDrag({ ...drag, ...p }); };
  const up = () => { if (!drag) return; const d = drag; setDrag(null); onChange && onChange((r) => { const it = r.items.find((i) => i.id === d.id); if (it) { it.x = d.x; it.y = d.y; } return r; }); };
  const remove = (e, it) => { if (!edit) return; e.preventDefault(); onChange && onChange((r) => { r.items = r.items.filter((i) => i.id !== it.id); return r; }); };
  const order = [...room.items].sort((a, b) => ((ITEM[a.k] || {}).at === 'wall' ? 0 : 1) - ((ITEM[b.k] || {}).at === 'wall' ? 0 : 1) || (a.y + ((ITEM[a.k] || {}).h || 0)) - (b.y + ((ITEM[b.k] || {}).h || 0)));
  const sealY = sealAt ? sealAt.y : H; const front = order.filter((it) => (ITEM[it.k] || {}).at === 'floor' && it.y + ITEM[it.k].h > sealY + 4 && it.k !== 'rug');
  const back = order.filter((it) => !front.includes(it));
  const pattern = room.wall === 'stripe' ? html`<pattern id="rw-p" width="24" height="10" patternUnits="userSpaceOnUse"><rect width="12" height="10" fill=${wall[3]}/></pattern>` : room.wall === 'dots' ? html`<pattern id="rw-p" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="2.2" fill=${wall[3]}/></pattern>` : null;
  const item = (it) => { const def = ITEM[it.k]; if (!def) return null; const at = drag && drag.id === it.id ? drag : it; return html`<g key=${it.id} transform=${`translate(${at.x} ${at.y})`} class=${'room-it' + (edit ? ' edit' : '') + (drag && drag.id === it.id ? ' dragging' : '')} onPointerDown=${(e) => down(e, it)} onContextMenu=${(e) => remove(e, it)}><title>${def.name}${edit ? '（拖动挪位置，右键拿走）' : ''}</title>${def.draw()}</g>`; };
  return html`<div class="room">
    <svg ref=${svg} class="room-svg" viewBox=${`0 0 ${W} ${H}`} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <defs>${pattern}</defs>
      <rect x="0" y="0" width=${W} height=${FLOOR} fill=${wall[2]}/>${pattern && html`<rect x="0" y="0" width=${W} height=${FLOOR} fill="url(#rw-p)"/>`}
      <rect x="0" y=${FLOOR} width=${W} height=${H - FLOOR} fill=${floor[2]}/>
      ${room.floor === 'wood' ? [0, 1, 2].map((i) => html`<path key=${i} d=${`M0 ${FLOOR + 22 + i * 28} H${W}`} stroke=${floor[3]} stroke-width="2"/>`) : room.floor === 'tile' ? Array.from({ length: 12 }, (_, i) => html`<path key=${i} d=${`M${i * 32} ${FLOOR} V${H}`} stroke=${floor[3]} stroke-width="1.5"/>`) : null}
      <rect x="0" y=${FLOOR - 4} width=${W} height="6" fill="#fff" opacity=".7"/>
      ${back.map(item)}
    </svg>
    ${sealAt && html`<div class="room-seal" style=${`left:${(sealAt.x / W) * 100}%;top:${(sealAt.y / H) * 100}%`}>${children}</div>`}
    ${front.length > 0 && html`<svg class="room-svg room-front" viewBox=${`0 0 ${W} ${H}`} style="pointer-events:none">${front.map((it) => html`<g key=${it.id} style="pointer-events:auto" transform=${`translate(${(drag && drag.id === it.id ? drag : it).x} ${(drag && drag.id === it.id ? drag : it).y})`} onPointerDown=${(e) => down(e, it)} onContextMenu=${(e) => remove(e, it)}>${ITEM[it.k].draw()}</g>`)}</svg>`}
  </div>`;
}

// 装饰面板：房间 + 下面一排可以拿出来的东西 + 墙纸 / 地板
export function RoomEditor({ s, children }) {
  const room = roomOf(s); const rounds = focusRounds(s); const change = (fn) => setRoom(fn);
  const add = (def) => change((r) => { const p = clampItem({ k: def.k }, W / 2 - def.w / 2 + (Math.random() * 60 - 30), def.at === 'wall' ? 30 : FLOOR); r.items.push({ id: Math.random().toString(36).slice(2, 9), k: def.k, ...p }); return r; });
  const next = ITEMS.filter((x) => !unlocked(x, rounds)).sort((a, b) => a.need - b.need)[0];
  return html`<div class="room-ed">
    <${Room} room=${room} edit=${true} sealAt=${sealSpot(room, false)} onChange=${change}>${children}<//>
    <div class="room-tools">
      <div class="rt-row"><b>墙纸</b>${WALLS.map(([k, l, c]) => html`<button type="button" key=${k} class=${'rt-sw ' + (room.wall === k ? 'on' : '')} style=${`--c:${c}`} title=${l} onClick=${() => change((r) => { r.wall = k; return r; })}><i></i>${l}</button>`)}</div>
      <div class="rt-row"><b>地板</b>${FLOORS.map(([k, l, c]) => html`<button type="button" key=${k} class=${'rt-sw ' + (room.floor === k ? 'on' : '')} style=${`--c:${c}`} onClick=${() => change((r) => { r.floor = k; return r; })}><i></i>${l}</button>`)}</div>
      <div class="rt-items">${ITEMS.map((def) => { const ok = unlocked(def, rounds); return html`<button type="button" key=${def.k} class=${'rt-it ' + (ok ? '' : 'locked')} disabled=${!ok} title=${ok ? '放进房间' : `再完成 ${def.need - rounds} 轮专注解锁`} onClick=${() => add(def)}><svg viewBox=${`-4 -4 ${def.w + 8} ${def.h + 8}`}>${def.draw()}</svg><span>${ok ? def.name : `🔒 ${def.need} 轮`}</span></button>`; })}</div>
      <p class="small muted">点一件放进房间，拖动挪位置，右键拿走。已经完成 ${rounds} 轮专注${next ? `，再 ${next.need - rounds} 轮解锁「${next.name}」` : '，全部解锁了'}。</p>
    </div>
  </div>`;
}
