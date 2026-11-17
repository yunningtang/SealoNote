// 汤圆的房间：一个斜 45° 看进去的小卧室（等轴测，像玩具屋的一个角），汤圆坐在里面。
//  · 家具都是有顶面、侧面明暗的小方块拼出来的，看起来是立体的；墙上的东西斜贴在左墙 / 右墙上
//  · 家具拖着在地板上走，墙上的东西拖着在墙上走（拖过中线换到另一面墙）；右键拿走
//  · 墙纸、地板可以换
//  · 有点活气：钟走真实时间，窗外白天 / 晚上跟着现在几点，天黑了台灯会亮；番茄钟在走时汤圆坐到书桌前
//  · 东西一件件解锁：每完成几轮专注（10 分钟以上算一轮）解锁一件，开局就有几件基础的
// 存在 settings.pet.room（v: 2），跟着账号同步。
import { html, useState, useRef, useEffect } from '../vendor/preact.js';
import { update, get } from './store.js';

export const W = 360, H = 300;
const CX = 180, TOP = 118, HW = 160, HH = 80, WALL = 112; // 地板菱形：最里面的角在 (CX, TOP)；墙高 WALL
// 地板坐标 (a, b) ∈ [0, 1]：a 往右下，b 往左下；z 是离地高度（像素）
const P = (a, b, z = 0) => [CX + (a - b) * HW, TOP + (a + b) * HH - z];
const pts = (...ps) => ps.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k)))); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); };
// 一个立体方块：顶面亮、右前面中、左前面暗
function box(a, b, wa, wb, z, h, c, extra = {}) {
  const t = z + h;
  return html`<g opacity=${extra.op || 1}>
    <polygon points=${pts(P(a + wa, b, z), P(a + wa, b + wb, z), P(a + wa, b + wb, t), P(a + wa, b, t))} fill=${shade(c, .82)} />
    <polygon points=${pts(P(a, b + wb, z), P(a + wa, b + wb, z), P(a + wa, b + wb, t), P(a, b + wb, t))} fill=${shade(c, .68)} />
    <polygon points=${pts(P(a, b, t), P(a + wa, b, t), P(a + wa, b + wb, t), P(a, b + wb, t))} fill=${shade(c, 1.08)} />
  </g>`;
}
// 一个立着的圆柱（花盆、杯子、灯座）：两个椭圆 + 侧面
function cyl(a, b, r, z, h, c) {
  const [x, y] = P(a, b, z); const rx = r * HW * 1.2, ry = rx * .5;
  return html`<g><path d=${`M${x - rx} ${y} V${y - h} A${rx} ${ry} 0 0 0 ${x + rx} ${y - h} V${y} A${rx} ${ry} 0 0 1 ${x - rx} ${y} Z`} fill=${shade(c, .8)} /><ellipse cx=${x} cy=${y - h} rx=${rx} ry=${ry} fill=${shade(c, 1.1)} /></g>`;
}
const night = () => { const h = new Date().getHours(); return h >= 19 || h < 6; };

export const WALLS = [['cream', '奶油', '#f4ead8'], ['mint', '薄荷', '#dcefe4'], ['sky', '天蓝', '#dbe8f6'], ['peach', '蜜桃', '#f8e1d5'], ['stripe', '条纹', '#f2ebdf'], ['dots', '圆点', '#ece9f6']];
export const FLOORS = [['wood', '木地板', '#d9b387'], ['carpet', '地毯', '#c9b9d6'], ['tile', '瓷砖', '#e4e4df']];

// 地上的东西：fa × fb 是占地（地板单位），draw(a, b) 画在那个位置
// 墙上的东西：w × h 像素的平面图，画好后斜贴到墙上
export const ITEMS = [
  { k: 'bed', ht: 40, name: '小床', at: 'floor', fa: .34, fb: .2, need: 0, draw: (a, b) => html`${box(a, b, .34, .2, 0, 10, '#b98a5e')}${box(a + .02, b + .01, .3, .18, 10, 9, '#ffffff')}${box(a + .1, b + .01, .22, .18, 19, 2, '#f2a7b8')}${box(a + .02, b + .03, .07, .14, 19, 5, '#ffffff')}${box(a, b, .025, .2, 10, 26, '#a97a4e')}` },
  { k: 'rug', ht: 6, name: '圆地毯', at: 'floor', fa: .3, fb: .3, flat: true, need: 0, draw: (a, b) => { const [x, y] = P(a + .15, b + .15); return html`<ellipse cx=${x} cy=${y} rx=${.3 * HW} ry=${.3 * HH} fill="#9cc3f5"/><ellipse cx=${x} cy=${y} rx=${.22 * HW} ry=${.22 * HH} fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="5 4" opacity=".85"/>`; } },
  { k: 'desk', ht: 42, name: '书桌', at: 'floor', fa: .24, fb: .14, need: 0, draw: (a, b) => html`${[[0, 0], [.21, 0], [0, .11], [.21, .11]].map(([da, db]) => box(a + da, b + db, .03, .03, 0, 30, '#9c7049'))}${box(a + .14, b + .01, .09, .12, 14, 16, '#c99f72')}${box(a, b, .24, .14, 30, 4, '#c08f5f')}${box(a + .05, b + .03, .06, .05, 34, 3, '#4f7cf5')}${cyl(a + .17, b + .06, .015, 34, 7, '#e8eef9')}` },
  { k: 'plant', ht: 48, name: '盆栽', at: 'floor', fa: .07, fb: .07, need: 0, draw: (a, b) => { const [x, y] = P(a + .035, b + .035, 16); return html`${cyl(a + .035, b + .035, .03, 0, 16, '#d98a5f')}<path d=${`M${x} ${y} C${x - 18} ${y - 6} ${x - 14} ${y - 26} ${x - 4} ${y - 30} C${x - 2} ${y - 18} ${x} ${y - 12} ${x} ${y} C${x} ${y - 14} ${x + 6} ${y - 24} ${x + 16} ${y - 26} C${x + 18} ${y - 12} ${x + 10} ${y - 4} ${x} ${y}`} fill="#5c9a52"/>`; } },
  { k: 'lamp', ht: 58, name: '台灯', at: 'floor', fa: .06, fb: .06, need: 0, draw: (a, b) => { const n = night(); const [x, y] = P(a + .03, b + .03, 0); return html`${n && html`<ellipse cx=${x} cy=${y - 44} rx="34" ry="26" fill="#ffe7a3" opacity=".4"/>`}${cyl(a + .03, b + .03, .025, 0, 4, '#6b6f78')}<rect x=${x - 1.5} y=${y - 40} width="3" height="36" fill="#6b6f78"/><path d=${`M${x - 12} ${y - 38} L${x - 6} ${y - 54} H${x + 6} L${x + 12} ${y - 38} Z`} fill=${n ? '#ffe28a' : '#f6cf63'}/>`; } },
  { k: 'mug', ht: 12, name: '马克杯', at: 'floor', fa: .04, fb: .04, need: 2, draw: (a, b) => html`${cyl(a + .02, b + .02, .018, 0, 9, '#e8eef9')}` },
  { k: 'shelf', ht: 74, name: '书架', at: 'floor', fa: .2, fb: .08, need: 4, draw: (a, b) => html`${box(a, b, .2, .08, 0, 70, '#b98a5e')}${[10, 32, 54].map((z, i) => html`${box(a + .015, b + .075, .17, .006, z, 18, '#7a5638')}${[['#d2524f', 0], ['#4f7cf5', .03], ['#f6cf63', .06], ['#4a9a6a', .09], ['#8a63c9', .12]].slice(0, 5 - i).map(([c, d]) => box(a + .02 + d, b + .055, .025, .025, z, 15, c))}`)}` },
  { k: 'books', ht: 18, name: '一摞书', at: 'floor', fa: .08, fb: .06, need: 4, draw: (a, b) => html`${box(a, b, .08, .06, 0, 5, '#4f7cf5')}${box(a + .005, b + .005, .07, .05, 5, 5, '#d2524f')}${box(a, b + .01, .075, .045, 10, 5, '#f6cf63')}` },
  { k: 'beanbag', ht: 36, name: '懒人沙发', at: 'floor', fa: .14, fb: .12, need: 6, draw: (a, b) => { const [x, y] = P(a + .07, b + .06); return html`<ellipse cx=${x} cy=${y - 2} rx="26" ry="12" fill="#c96f38"/><path d=${`M${x - 26} ${y - 2} C${x - 28} ${y - 26} ${x - 10} ${y - 34} ${x} ${y - 34} C${x + 14} ${y - 34} ${x + 28} ${y - 22} ${x + 26} ${y - 2} Z`} fill="#e0894f"/><path d=${`M${x - 14} ${y - 16} C${x - 4} ${y - 22} ${x + 8} ${y - 22} ${x + 16} ${y - 14}`} stroke="#c96f38" stroke-width="2" fill="none"/>`; } },
  { k: 'tank', ht: 40, name: '鱼缸', at: 'floor', fa: .14, fb: .07, need: 12, draw: (a, b) => { const [x, y] = P(a + .07, b + .07, 10); return html`${box(a, b, .14, .07, 0, 10, '#6b6f78')}${box(a, b, .14, .07, 10, 26, '#bfe3ff', { op: .7 })}<path d=${`M${x - 6} ${y - 12} l6 -3 v6 z M${x} ${y - 12} c2 -3 7 -3 8 0 c-1 3 -6 3 -8 0`} fill="#e0894f"/>`; } },
  { k: 'catpillow', ht: 28, name: '猫咪抱枕', at: 'floor', fa: .09, fb: .06, need: 16, draw: (a, b) => { const [x, y] = P(a + .045, b + .03, 0); return html`<path d=${`M${x - 15} ${y} C${x - 17} ${y - 14} ${x - 14} ${y - 22} ${x - 11} ${y - 26} L${x - 6} ${y - 19} H${x + 6} L${x + 11} ${y - 26} C${x + 14} ${y - 22} ${x + 17} ${y - 14} ${x + 15} ${y} Z`} fill="#f6eedf" stroke="#e3d2bc" stroke-width="1.5"/><circle cx=${x - 5} cy=${y - 12} r="1.6" fill="#222"/><circle cx=${x + 5} cy=${y - 12} r="1.6" fill="#222"/>`; } },
  // 墙上的
  { k: 'window', name: '窗户', at: 'wall', w: 62, h: 52, need: 0, draw: () => { const n = night(); return html`<rect x="0" y="0" width="62" height="52" rx="4" fill="#fff"/><rect x="4" y="4" width="54" height="44" rx="2" fill=${n ? '#25335a' : '#bfe3ff'}/>${n ? html`<circle cx="44" cy="15" r="6" fill="#f6e7a8"/><circle cx="16" cy="12" r="1.3" fill="#fff"/>` : html`<circle cx="45" cy="14" r="7" fill="#ffd66b"/><path d="M8 38 Q18 30 28 38 T52 38 V48 H8 Z" fill="#9fd39a"/>`}<path d="M31 4 V48 M4 26 H58" stroke="#fff" stroke-width="3.5"/><rect x="-3" y="49" width="68" height="5" rx="2" fill="#e3d2bc"/>`; } },
  { k: 'clock', name: '挂钟', at: 'wall', w: 30, h: 30, need: 0, draw: () => { const d = new Date(); const m = d.getMinutes(), h = (d.getHours() % 12) + m / 60; const hand = (deg, len) => { const a = (deg - 90) * Math.PI / 180; return `M15 15 L${15 + Math.cos(a) * len} ${15 + Math.sin(a) * len}`; }; return html`<circle cx="15" cy="15" r="14" fill="#fff" stroke="#c99f72" stroke-width="3"/><path d=${hand(h * 30, 6)} stroke="#1f1e1c" stroke-width="2.2" stroke-linecap="round"/><path d=${hand(m * 6, 10)} stroke="#1f1e1c" stroke-width="1.5" stroke-linecap="round"/><circle cx="15" cy="15" r="1.6" fill="#d2524f"/>`; } },
  { k: 'poster', name: '海豹海报', at: 'wall', w: 36, h: 46, need: 2, draw: () => html`<rect x="0" y="0" width="36" height="46" rx="2" fill="#fff" stroke="#e3d2bc" stroke-width="2"/><rect x="4" y="4" width="28" height="32" fill="#cfe6f7"/><ellipse cx="18" cy="25" rx="9" ry="7.5" fill="#fff"/><circle cx="15" cy="24" r="1.2" fill="#222"/><circle cx="21" cy="24" r="1.2" fill="#222"/><rect x="7" y="39" width="22" height="3" rx="1.5" fill="#d8cdbb"/>` },
  { k: 'wallshelf', name: '小壁架', at: 'wall', w: 64, h: 30, need: 6, draw: () => html`<rect x="0" y="22" width="64" height="5" rx="2" fill="#b98a5e"/><path d="M8 22 C2 16 6 6 12 4 C14 12 14 16 12 22" fill="#5c9a52"/><rect x="6" y="14" width="10" height="8" fill="#d98a5f"/><rect x="28" y="8" width="7" height="14" fill="#4f7cf5"/><rect x="36" y="10" width="7" height="12" fill="#f6cf63"/><circle cx="54" cy="16" r="6" fill="#f2a7b8"/>` },
  { k: 'lights', name: '星星灯', at: 'wall', w: 110, h: 20, need: 8, draw: () => html`<path d="M0 3 Q55 22 110 3" stroke="#8a8f98" stroke-width="1.2" fill="none"/>${[8, 26, 44, 62, 80, 98].map((x, i) => { const y = 3 + Math.sin((x / 110) * Math.PI) * 10; return html`<circle cx=${x} cy=${y + 4} r="3.2" fill=${['#f6cf63', '#f2a7b8', '#9cc3f5'][i % 3]} opacity=${night() ? 1 : .85}/>`; })}` },
  { k: 'poster2', name: '山的海报', at: 'wall', w: 50, h: 36, need: 8, draw: () => html`<rect x="0" y="0" width="50" height="36" rx="2" fill="#fff" stroke="#e3d2bc" stroke-width="2"/><rect x="4" y="4" width="42" height="28" fill="#ffe7cf"/><path d="M4 32 L17 13 L26 24 L33 15 L46 32 Z" fill="#6aa85a"/><circle cx="38" cy="10" r="3.5" fill="#e0894f"/>` },
];
const ITEM = Object.fromEntries(ITEMS.map((x) => [x.k, x]));

export const focusRounds = (s = get()) => (s.sessions || []).filter((x) => (x.mins || 0) >= 10).length;
export const unlocked = (it, rounds) => rounds >= (it.need || 0);

// 地上的东西存 a / b；墙上的东西存 wall（L 左墙 / R 右墙）、t（沿着墙 0..1）、z（离地高度）
export const DEFAULT_ROOM = { v: 2, wall: 'cream', floor: 'wood', items: [
  { id: 'w1', k: 'window', wall: 'R', t: .3, z: 52 }, { id: 'c1', k: 'clock', wall: 'L', t: .3, z: 100 },
  { id: 'b1', k: 'bed', a: .03, b: .5 }, { id: 'r1', k: 'rug', a: .4, b: .42 }, { id: 'p1', k: 'plant', a: .82, b: .06 }, { id: 'l1', k: 'lamp', a: .03, b: .74 },
] };
export const roomOf = (s) => { const r = (s && s.settings && s.settings.pet && s.settings.pet.room) || null; return r && r.v === 2 && Array.isArray(r.items) ? r : DEFAULT_ROOM; };
export const setRoom = (fn) => update((d) => { const pet = d.settings.pet = d.settings.pet || {}; const cur = JSON.parse(JSON.stringify(roomOf(d))); pet.room = fn(cur) || cur; pet.room.v = 2; });

const clampFloor = (def, a, b) => ({ a: +Math.max(0, Math.min(1 - def.fa, a)).toFixed(3), b: +Math.max(0, Math.min(1 - def.fb, b)).toFixed(3) });
const clampWall = (def, t, z) => ({ t: +Math.max(0, Math.min(1 - def.w / (HW * 2.236), t)).toFixed(3), z: Math.round(Math.max(def.h + 4, Math.min(WALL - 4, z))) });
// 墙上的东西：先画平面图，再斜贴到墙上（右墙沿 a 方向，左墙沿 b 方向）
const SK = Math.atan2(HH, HW) * 180 / Math.PI;
function wallTransform(it, def) {
  if (it.wall === 'L') { const [x, y] = P(0, it.t, it.z); return `translate(${x - def.w} ${y + (def.w * HH / HW)}) skewY(${-SK})`; }
  const [x, y] = P(it.t, 0, it.z); return `translate(${x} ${y}) skewY(${SK})`;
}

// 汤圆坐在哪（地板坐标）：番茄钟在走、有书桌就坐到书桌前，不然坐在地毯中间，都没有就在房间中间
export function sealSpot(room, working) {
  const desk = working && room.items.find((x) => x.k === 'desk'); const at = desk ? { a: desk.a + .12, b: desk.b + .2 } : (() => { const rug = room.items.find((x) => x.k === 'rug'); return rug ? { a: rug.a + .15, b: rug.b + .15 } : { a: .5, b: .5 }; })();
  const [x, y] = P(Math.min(1, at.a), Math.min(1, at.b)); return { x, y, depth: at.a + at.b };
}

export function Room({ room, edit = false, sealAt, children, onChange }) {
  const svg = useRef(); const [drag, setDrag] = useState(null); const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30e3); return () => clearInterval(t); }, []);
  const wallC = (WALLS.find((w) => w[0] === room.wall) || WALLS[0])[2]; const floorC = (FLOORS.find((f) => f[0] === room.floor) || FLOORS[0])[2];
  const toLocal = (e) => { const r = svg.current.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  const toFloor = (x, y) => { const u = (x - CX) / HW, v = (y - TOP) / HH; return [(u + v) / 2, (v - u) / 2]; };
  const down = (e, it) => { if (!edit || e.button !== 0) return; e.stopPropagation(); e.preventDefault(); svg.current.setPointerCapture(e.pointerId); const [x, y] = toLocal(e); setDrag({ id: it.id, sx: x, sy: y, it: { ...it } }); };
  const move = (e) => {
    if (!drag) return; const [x, y] = toLocal(e); const def = ITEM[drag.it.k]; const base = room.items.find((i) => i.id === drag.id); if (!def || !base) return;
    if (def.at === 'floor') { const [a0, b0] = toFloor(drag.sx, drag.sy), [a1, b1] = toFloor(x, y); setDrag({ ...drag, it: { ...base, ...clampFloor(def, base.a + a1 - a0, base.b + b1 - b0) } }); }
    else { const wall = x < CX ? 'L' : 'R'; const along = wall === 'R' ? (x - CX) / HW : (CX - x) / HW; const t = along; const floorY = wall === 'R' ? P(t, 0)[1] : P(0, t)[1]; setDrag({ ...drag, it: { ...base, wall, ...clampWall(def, t - (wall === 'R' ? def.w / 2 / HW : -def.w / 2 / HW), floorY - y + def.h / 2) } }); }
  };
  const up = () => { if (!drag) return; const d = drag; setDrag(null); onChange && onChange((r) => { const i = r.items.findIndex((x) => x.id === d.id); if (i >= 0) r.items[i] = d.it; return r; }); };
  const remove = (e, it) => { if (!edit) return; e.preventDefault(); onChange && onChange((r) => { r.items = r.items.filter((i) => i.id !== it.id); return r; }); };
  const cur = (it) => (drag && drag.id === it.id ? drag.it : it);
  const items = room.items.map(cur).filter((it) => ITEM[it.k]);
  const wallIts = items.filter((it) => ITEM[it.k].at === 'wall');
  const flat = items.filter((it) => ITEM[it.k].flat);
  const solid = items.filter((it) => ITEM[it.k].at === 'floor' && !ITEM[it.k].flat).sort((x, y) => (x.a + ITEM[x.k].fa + x.b + ITEM[x.k].fb) - (y.a + ITEM[y.k].fa + y.b + ITEM[y.k].fb));
  const sDepth = sealAt ? sealAt.depth : 9; const behind = solid.filter((it) => it.a + ITEM[it.k].fa + it.b + ITEM[it.k].fb <= sDepth + .06), front = solid.filter((it) => !behind.includes(it));
  const g = (it) => { const def = ITEM[it.k]; return html`<g key=${it.id} class=${'room-it' + (edit ? ' edit' : '') + (drag && drag.id === it.id ? ' dragging' : '')} onPointerDown=${(e) => down(e, it)} onContextMenu=${(e) => remove(e, it)}><title>${def.name}${edit ? '（拖动挪位置，右键拿走）' : ''}</title>${def.at === 'wall' ? html`<g transform=${wallTransform(it, def)}>${def.draw()}</g>` : def.draw(it.a, it.b)}</g>`; };
  // 墙纸花纹 / 地板纹
  const deco = [];
  if (room.wall === 'stripe') for (let i = 1; i < 16; i++) { const t = i / 16; deco.push(html`<path key=${'sr' + i} d=${`M${P(t, 0)[0]} ${P(t, 0)[1]} V${P(t, 0, WALL)[1]}`} stroke=${shade(wallC, .93)} stroke-width="5"/>`, html`<path key=${'sl' + i} d=${`M${P(0, t)[0]} ${P(0, t)[1]} V${P(0, t, WALL)[1]}`} stroke=${shade(wallC, .9)} stroke-width="5"/>`); }
  if (room.wall === 'dots') for (let i = 1; i < 10; i++) for (let j = 1; j < 6; j++) { const t = i / 10, z = j * WALL / 6; deco.push(html`<circle key=${`d${i}${j}`} cx=${P(t, 0, z)[0]} cy=${P(t, 0, z)[1]} r="2" fill=${shade(wallC, .88)}/>`, html`<circle key=${`e${i}${j}`} cx=${P(0, t, z)[0]} cy=${P(0, t, z)[1]} r="2" fill=${shade(wallC, .86)}/>`); }
  const fl = []; const n = room.floor === 'tile' ? 6 : room.floor === 'wood' ? 9 : 0;
  for (let i = 1; i < n; i++) { const t = i / n; fl.push(html`<path key=${'f' + i} d=${`M${P(t, 0)[0]} ${P(t, 0)[1]} L${P(t, 1)[0]} ${P(t, 1)[1]}`} stroke=${shade(floorC, .9)} stroke-width="1.2"/>`); if (room.floor === 'tile') fl.push(html`<path key=${'g' + i} d=${`M${P(0, t)[0]} ${P(0, t)[1]} L${P(1, t)[0]} ${P(1, t)[1]}`} stroke=${shade(floorC, .9)} stroke-width="1.2"/>`); }
  return html`<div class="room">
    <svg ref=${svg} class="room-svg" viewBox=${`0 0 ${W} ${H}`} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <polygon points=${pts(P(0, 0, WALL), P(0, 0), P(0, 1), P(0, 1, WALL))} fill=${shade(wallC, .94)}/>
      <polygon points=${pts(P(0, 0, WALL), P(0, 0), P(1, 0), P(1, 0, WALL))} fill=${wallC}/>
      ${deco}
      <polygon points=${pts(P(0, 0), P(1, 0), P(1, 1), P(0, 1))} fill=${floorC}/>
      ${fl}
      <polyline points=${pts(P(0, 1), P(0, 0), P(1, 0))} fill="none" stroke="#fff" stroke-width="3" opacity=".7"/>
      <polygon points=${pts(P(0, 1), P(1, 1), P(1, 1, -8), P(0, 1, -8))} fill=${shade(floorC, .7)}/><polygon points=${pts(P(1, 0), P(1, 1), P(1, 1, -8), P(1, 0, -8))} fill=${shade(floorC, .8)}/>
      ${wallIts.map(g)}${flat.map(g)}${behind.map(g)}
    </svg>
    ${sealAt && html`<div class="room-seal" style=${`left:${(sealAt.x / W) * 100}%;top:${(sealAt.y / H) * 100}%`}>${children}</div>`}
    ${front.length > 0 && html`<svg class="room-svg room-front" viewBox=${`0 0 ${W} ${H}`} onPointerMove=${move} onPointerUp=${up}>${front.map(g)}</svg>`}
  </div>`;
}

export function RoomEditor({ s, children }) {
  const room = roomOf(s); const rounds = focusRounds(s); const change = (fn) => setRoom(fn);
  const add = (def) => change((r) => { const id = Math.random().toString(36).slice(2, 9); r.items.push(def.at === 'wall' ? { id, k: def.k, wall: Math.random() < .5 ? 'L' : 'R', ...clampWall(def, .25 + Math.random() * .4, 70) } : { id, k: def.k, ...clampFloor(def, .3 + Math.random() * .3, .3 + Math.random() * .3) }); return r; });
  const next = ITEMS.filter((x) => !unlocked(x, rounds)).sort((a, b) => a.need - b.need)[0];
  // 图标：按这件东西自己的大小取景，小东西（杯子、书）也看得清
  const icon = (def) => def.at === 'wall' ? html`<svg viewBox=${`-4 -4 ${def.w + 8} ${def.h + 8}`}>${def.draw()}</svg>` : (() => { const a = .5 - def.fa / 2, b = .5 - def.fb / 2; const xl = P(a, b + def.fb)[0], xr = P(a + def.fa, b)[0], yb = P(a + def.fa, b + def.fb)[1], yt = P(a, b)[1] - (def.ht || 40); const pad = 6, w = xr - xl + pad * 2, h = yb - yt + pad * 2, sz = Math.max(w, h * 1.3); return html`<svg viewBox=${`${(xl + xr) / 2 - sz / 2} ${(yt + yb) / 2 - sz / 2.6} ${sz} ${sz / 1.3}`}>${def.draw(a, b)}</svg>`; })();
  return html`<div class="room-ed">
    <${Room} room=${room} edit=${true} sealAt=${sealSpot(room, false)} onChange=${change}>${children}<//>
    <div class="room-tools">
      <div class="rt-row"><b>墙纸</b>${WALLS.map(([k, l, c]) => html`<button type="button" key=${k} class=${'rt-sw ' + (room.wall === k ? 'on' : '')} style=${`--c:${c}`} onClick=${() => change((r) => { r.wall = k; return r; })}><i></i>${l}</button>`)}</div>
      <div class="rt-row"><b>地板</b>${FLOORS.map(([k, l, c]) => html`<button type="button" key=${k} class=${'rt-sw ' + (room.floor === k ? 'on' : '')} style=${`--c:${c}`} onClick=${() => change((r) => { r.floor = k; return r; })}><i></i>${l}</button>`)}</div>
      <div class="rt-items">${ITEMS.map((def) => { const ok = unlocked(def, rounds); return html`<button type="button" key=${def.k} class=${'rt-it ' + (ok ? '' : 'locked')} disabled=${!ok} title=${ok ? '放进房间' : `再完成 ${def.need - rounds} 轮专注解锁`} onClick=${() => add(def)}>${icon(def)}<span>${ok ? def.name : `🔒 ${def.need} 轮`}</span></button>`; })}</div>
      <p class="small muted">点一件放进房间，拖动挪位置（墙上的东西拖过中线会换到另一面墙），右键拿走。已经完成 ${rounds} 轮专注${next ? `，再 ${next.need - rounds} 轮解锁「${next.name}」` : '，全部解锁了'}。</p>
    </div>
  </div>`;
}
