// 桌面汤圆（#/pet）：桌面版里一个透明的小窗口，汤圆坐在自己的小屋上。
//  · 你打字时它跟着拍鳍（只知道「按了一下」，不知道按了什么），下面写着今天敲了多少下
//  · 番茄钟在走时头顶有个计时环，点一下暂停 / 继续
//  · 按住拖：挪到桌面任何地方（可以固定住）；往上一甩：打开便签；点一下：菜单；Ctrl + 滚轮：变大变小
//  · 帽子、围巾、小屋在「设置 → 汤圆」里换，跟着账号同步
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { loadThree, buildSeal } from '../seal3d.js';
import * as pomo from '../pomo.js';
import { Room, roomOf, sealSpot } from '../room.js';

export const HATS = [['', '不戴'], ['beanie', '毛线帽'], ['bow', '蝴蝶结'], ['crown', '小皇冠'], ['phones', '耳机'], ['straw', '草帽'], ['party', '生日帽'], ['chef', '厨师帽'], ['bunny', '兔耳朵'], ['flowers', '花环'], ['cap', '贝雷帽']];
export const NECKS = [['', '不戴'], ['bowtie', '领结'], ['bell', '小铃铛']];
export const SCARVES = [['', '不戴'], ['#d2524f', '红'], ['#4f7cf5', '蓝'], ['#4a9a6a', '绿'], ['#e0a23c', '黄'], ['#8a63c9', '紫']];
// 只取跟样子有关的几项（房间等别的设置变了不用重拍）
export const petLook = (s) => { const p = (s && s.settings && s.settings.pet) || {}; return { hat: p.hat || '', scarf: p.scarf || '', neck: p.neck || '' }; };
export const setPetLook = (patch) => update((d) => { d.settings.pet = { ...(d.settings.pet || {}), ...patch }; });

// 往 3D 汤圆身上挂东西：帽子挂在头上，围巾挂在脖子上
function dress(THREE, m, look) {
  const old = m.__dress || []; old.forEach((o) => o.parent && o.parent.remove(o)); m.__dress = [];
  const add = (parent, o) => { parent.add(o); m.__dress.push(o); return o; };
  // 汤圆身上有一层毛（往外大约 0.08）：衣服要穿在毛外面，不然被毛盖住、颜色发白
  // 场景的色调映射会把颜色压灰：自带一点点自发光，颜色看起来就是选的那个颜色
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: .22, roughness: .62, envMapIntensity: .35, ...extra });
  const OUT = m.HR + .14;
  const top = m.head.position.y + OUT * .97; // 头顶（headPiv 坐标）
  if (look.hat === 'beanie') {
    const g = new THREE.Group(); g.position.set(0, m.head.position.y, m.head.position.z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(OUT, 48, 24, 0, Math.PI * 2, 0, Math.PI * .36), mat(0xc9302c)); cap.rotation.x = -.18; g.add(cap);
    const band = new THREE.Mesh(new THREE.TorusGeometry(OUT * .87, .1, 16, 48), mat(0xf6f1e7)); band.rotation.x = Math.PI / 2 - .18; band.position.y = OUT * .5; band.position.z = -.06; g.add(band);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(.18, 24, 16), mat(0xf3efe6)); pom.position.set(0, OUT * 1.06, -.2); g.add(pom);
    add(m.headPiv, g);
  } else if (look.hat === 'bow') {
    const g = new THREE.Group(); g.position.set(.5, top - .14, m.head.position.z + .12); g.rotation.z = -.35;
    const red = mat(0xe03a6a);
    [-1, 1].forEach((sx) => { const w = new THREE.Mesh(new THREE.ConeGeometry(.2, .36, 24), red); w.rotation.z = sx * Math.PI / 2; w.position.x = sx * .18; g.add(w); });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), red));
    add(m.headPiv, g);
  } else if (look.hat === 'crown') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8aa1c, metalness: .6, roughness: .3, envMapIntensity: .9 });
    const g = new THREE.Group(); g.position.set(0, top - .02, m.head.position.z - .05); g.rotation.x = -.12;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(.4, .44, .2, 32, 1, true), gold));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const c = new THREE.Mesh(new THREE.ConeGeometry(.07, .2, 12), gold); c.position.set(Math.sin(a) * .41, .18, Math.cos(a) * .41); g.add(c); }
    add(m.headPiv, g);
  } else if (look.hat === 'phones') {
    const dark = mat(0x26282d);
    const g = new THREE.Group(); g.position.set(0, m.head.position.y, m.head.position.z - .05);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(OUT * 1.02, .07, 12, 48, Math.PI), dark); g.add(arc);
    [-1, 1].forEach((sx) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(.24, .24, .2, 28), mat(0x2f62e0)); cup.rotation.z = Math.PI / 2; cup.position.set(sx * OUT * 1.02, 0, 0); g.add(cup); });
    add(m.headPiv, g);
  }
  else if (look.hat === 'straw') {
    const straw = mat(0xeccb7e, { roughness: .85, emissiveIntensity: .3 });
    const g = new THREE.Group(); g.position.set(0, top - .3, m.head.position.z - .06); g.rotation.x = -.2;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(.95, 1, .05, 48), straw); g.add(brim);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(.5, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), straw); crown.scale.y = .8; g.add(crown);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.505, .505, .1, 40, 1, true), mat(0xd2524f)); band.position.y = .06; g.add(band);
    add(m.headPiv, g);
  } else if (look.hat === 'party') {
    const g = new THREE.Group(); g.position.set(.3, top - .14, m.head.position.z + .05); g.rotation.z = -.42;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.24, .5, 36), mat(0x3f6fe8)); cone.position.y = .22; g.add(cone);
    for (let i = 0; i < 2; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.2 - i * .085, .028, 8, 32), mat(0xf6cf63)); r.rotation.x = Math.PI / 2; r.position.y = .1 + i * .17; g.add(r); }
    const pom = new THREE.Mesh(new THREE.SphereGeometry(.08, 16, 12), mat(0xe03a6a)); pom.position.y = .5; g.add(pom);
    add(m.headPiv, g);
  } else if (look.hat === 'chef') {
    const white = mat(0xfbfbf8, { roughness: .9 });
    const g = new THREE.Group(); g.position.set(0, top - .08, m.head.position.z - .05);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.46, .48, .3, 36), white); band.position.y = .08; g.add(band);
    [[0, .45, 0, .36], [-.24, .38, 0, .28], [.24, .38, 0, .28], [0, .38, -.2, .28], [0, .38, .2, .28]].forEach(([x, y, z, r]) => { const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), white); puff.position.set(x, y, z); g.add(puff); });
    add(m.headPiv, g);
  } else if (look.hat === 'bunny') {
    const furW = mat(0xf7f7f7, { roughness: .95 }), pink = mat(0xf2a7b8);
    [-1, 1].forEach((sx) => {
      const g = new THREE.Group(); g.position.set(sx * .3, top - .08, m.head.position.z - .05); g.rotation.z = -sx * .22;
      const ear = new THREE.Mesh(new THREE.SphereGeometry(.15, 24, 16), furW); ear.scale.set(1, 3.2, .55); ear.position.y = .42; g.add(ear);
      const inner = new THREE.Mesh(new THREE.SphereGeometry(.09, 16, 12), pink); inner.scale.set(1, 3.6, .3); inner.position.set(0, .42, .06); g.add(inner);
      add(m.headPiv, g);
    });
  } else if (look.hat === 'flowers') {
    const g = new THREE.Group(); g.position.set(0, top - .2, m.head.position.z - .02); g.rotation.x = -.32;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.56, .05, 8, 40), mat(0x5c9a52)); ring.rotation.x = Math.PI / 2; g.add(ring);
    const cols = [0xf2a7b8, 0xf6cf63, 0xffffff, 0xc9a7f0];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; const f = new THREE.Group(); f.position.set(Math.sin(a) * .56, .06, Math.cos(a) * .56);
      for (let k = 0; k < 5; k++) { const pa = (k / 5) * Math.PI * 2; const pt = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 10), mat(cols[i % cols.length])); pt.scale.y = .6; pt.position.set(Math.cos(pa) * .1, .03, Math.sin(pa) * .1); f.add(pt); }
      const c = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 8), mat(0xe8aa1c)); c.position.y = .07; f.add(c); g.add(f); }
    add(m.headPiv, g);
  } else if (look.hat === 'cap') {
    const navy = mat(0xb8364a);
    const g = new THREE.Group(); g.position.set(0, m.head.position.y, m.head.position.z); g.rotation.x = -.1; g.rotation.z = .22;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(OUT, 40, 20, 0, Math.PI * 2, 0, Math.PI * .3), navy); g.add(dome);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(.02, .03, .1, 8), mat(0x7a1f2e)); btn.position.y = OUT + .02; g.add(btn);
    add(m.headPiv, g);
  }
  if (look.neck === 'bowtie') {
    const red = mat(0xc9302c);
    const g = new THREE.Group(); g.position.set(0, m.headPiv.position.y - .32, m.headPiv.position.z + .78); g.rotation.x = -.15;
    [-1, 1].forEach((sx) => { const w = new THREE.Mesh(new THREE.ConeGeometry(.15, .26, 3), red); w.rotation.z = sx * Math.PI / 2; w.position.x = sx * .13; g.add(w); });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(.065, 12, 8), red));
    add(m.rig, g);
  } else if (look.neck === 'bell') {
    const g = new THREE.Group(); g.position.set(0, m.headPiv.position.y - .3, m.headPiv.position.z + .02); g.rotation.x = Math.PI / 2 - .25;
    g.add(new THREE.Mesh(new THREE.TorusGeometry(.76, .07, 12, 48), mat(0xd2524f)));
    add(m.rig, g);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(.13, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe8aa1c, metalness: .7, roughness: .25, envMapIntensity: 1 }));
    bell.position.set(0, m.headPiv.position.y - .42, m.headPiv.position.z + .8); add(m.rig, bell);
  }
  if (look.scarf && look.neck !== 'bell') {
    const g = new THREE.Group(); g.position.set(0, m.headPiv.position.y - .3, m.headPiv.position.z + .02); g.rotation.x = Math.PI / 2 - .25;
    g.add(new THREE.Mesh(new THREE.TorusGeometry(.76, .15, 16, 48), mat(look.scarf)));
    const tail = new THREE.Mesh(new THREE.BoxGeometry(.24, .52, .09), mat(look.scarf)); tail.position.set(.36, .62, -.08); tail.rotation.z = -.2; g.add(tail);
    add(m.rig, g);
  }
}

// 「定格画」：用 3D 模型拍几张姿势，拍完立刻释放 3D（同一时间只拍一组，拍过的记住）
const framesCache = new Map(); let snapQ = Promise.resolve(null);
export const FALLBACK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M16 96 C12 64 32 34 60 34 C88 34 108 64 104 96 C102 108 84 112 60 112 C36 112 18 108 16 96 Z" fill="#eef0f3" stroke="#d3d2cd" stroke-width="1.5"/><circle cx="44" cy="72" r="5" fill="#1f1e1c"/><circle cx="76" cy="72" r="5" fill="#1f1e1c"/></svg>');
export function snapFrames(look) {
  const key = JSON.stringify(look); if (framesCache.has(key)) return Promise.resolve(framesCache.get(key));
  snapQ = snapQ.catch(() => null).then(async () => {
    if (framesCache.has(key)) return framesCache.get(key);
    const THREE = await loadThree(); const cv = document.createElement('canvas'); cv.width = cv.height = 190;
    let m; try { m = buildSeal(THREE, cv, 190); } catch { return null; }
    try {
      m.renderer.setPixelRatio(Math.min(3, Math.max(2, window.devicePixelRatio || 1))); m.renderer.setSize(190, 190, false);
      dress(THREE, m, look); m.seal.scale.setScalar(.84); m.seal.position.y = -.2; m.shadowMesh.position.y -= .2; // 给高帽子留出头顶的空间
      const base = () => { m.rig.position.y = 0; m.headPiv.rotation.z = 0; m.tailPiv.rotation.y = 0; m.flips.forEach(({ piv, sx }) => { piv.rotation.z = sx * -.22; }); m.eyes.forEach((e) => { e.scale.y = 1; }); };
      const shot = () => { m.renderer.render(m.scene, m.camera); return cv.toDataURL('image/png'); };
      const f = {}; base(); f.idle = shot();
      base(); m.eyes.forEach((e) => { e.scale.y = .08; }); f.blink = shot();
      for (const [name, sd] of [['left', -1], ['right', 1]]) { base(); m.rig.position.y = .05; m.headPiv.rotation.z = sd * .08; m.tailPiv.rotation.y = sd * .15; m.flips.forEach(({ piv, sx }) => { piv.rotation.z = sx * -.22 + (sx === sd ? sx * .9 : 0); }); f[name] = shot(); }
      framesCache.set(key, f); return f;
    } finally { try { m.dispose(); m.renderer.forceContextLoss(); } catch {} }
  });
  return snapQ;
}

function usePomo() { const [st, set] = useState(pomo.get()); useEffect(() => pomo.subscribe((x) => set({ ...x })), []); const [, tick] = useState(0); useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []); return st; }

export default function Pet({ preview = false, bare = false }) {
  const s = useStore(); const look = petLook(s);
  const desk = !preview && typeof window !== 'undefined' && window.sealonote && window.sealonote.pet;
  const side = useRef(1);
  const [keys, setKeys] = useState({ today: 0, on: false, running: false, needsPermission: false });
  const [menu, setMenu] = useState(false); const [msg, setMsg] = useState('');
  const st = usePomo();

  // 汤圆用「定格画」：开始时用 3D 模型拍好几张姿势（平时 / 眨眼 / 左鳍拍 / 右鳍拍 / 开心），拍完就把 3D 关掉，
  // 之后只是换图片（像 BongoCat 那样）——不再一直占着显卡，不卡，也不会因为显卡收回画布而消失。换装时重拍一次。
  const [frames, setFrames] = useState(() => framesCache.get(JSON.stringify(look)) || null);
  const [pose, setPose] = useState('idle'); const poseT = useRef(0);
  const lookKey = JSON.stringify(look);
  useEffect(() => { let dead = false; snapFrames(look).then((f) => { if (!dead && f) setFrames(f); }); return () => { dead = true; }; }, [lookKey]);
  // 眨眼：每隔几秒眨一下（只换一张图）
  useEffect(() => { let t; const blink = () => { t = setTimeout(() => { if (!poseT.current) { setPose('blink'); setTimeout(() => setPose((p) => (p === 'blink' ? 'idle' : p)), 140); } blink(); }, 2600 + Math.random() * 3800); }; blink(); return () => clearTimeout(t); }, []);
  const flap = () => { side.current = -side.current; setPose(side.current > 0 ? 'right' : 'left'); clearTimeout(poseT.current); poseT.current = setTimeout(() => { poseT.current = 0; setPose('idle'); }, 120); };
  const [tilt, setTilt] = useState(0); const [bounce, setBounce] = useState(0);
  // 点击穿透：窗口是透明的长方形，只有汤圆本身、计时、菜单这些看得见的地方接鼠标，别的地方点下去是点到后面的东西
  useEffect(() => {
    if (!desk || !desk.setHit) return; let on = null; const set = (v) => { if (v !== on) { on = v; desk.setHit(v); } };
    const mv = (e) => { if (drag.current) { set(true); return; } const el = document.elementFromPoint(e.clientX, e.clientY); set(!!(el && el.closest('.pet-doll,.pet-pomo,.pet-menu,.pet-keys,.pet-say:not(.ghost),.room-svg,.room-it'))); };
    const out = () => { if (!drag.current) set(false); };
    addEventListener('mousemove', mv); document.documentElement.addEventListener('mouseleave', out); set(false);
    return () => { removeEventListener('mousemove', mv); document.documentElement.removeEventListener('mouseleave', out); };
  }, []);
  // 按键次数（只有桌面版有）
  useEffect(() => {
    if (!desk) return;
    desk.stats().then(setKeys).catch(() => {});
    // 数字最多每 0.3 秒刷新一次：打字很快时不用每个键都重画
    let last = 0, pend = 0; const show = (v) => { last = performance.now(); setKeys((k) => ({ ...k, today: v.today, running: true })); };
    return desk.onKey((v) => { flap(); const now = performance.now(); clearTimeout(pend); if (now - last > 300) show(v); else pend = setTimeout(() => show(v), 300); });
  }, []);
  // 网页里预览时：在这个页面里打字也会拍
  useEffect(() => { if (desk || !preview) return; addEventListener('keydown', flap); return () => removeEventListener('keydown', flap); }, []);

  // 大小 / 固定位置：每台电脑自己记（屏幕不一样）
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const [size, setSizeS] = useState(() => ls('ytos.pet.size', 1)); const [locked, setLockedS] = useState(() => ls('ytos.pet.locked', false));
  const canSize = !!(desk && desk.setScale);
  const canRoom = !!(desk && desk.setRoom);
  const [roomOn, setRoomOn] = useState(() => !preview && ls('ytos.pet.room', false));
  const toggleRoom = () => { const v = !roomOn; setRoomOn(v); try { localStorage.setItem('ytos.pet.room', JSON.stringify(v)); } catch {} if (canRoom) desk.setRoom(v); say(v ? '欢迎来我房间' : '我出来啦'); };
  useEffect(() => { if (canRoom && roomOn) desk.setRoom(true); }, []);
  const setSize = (k) => { k = Math.max(.6, Math.min(1.8, Math.round(k * 10) / 10)); setSizeS(k); try { localStorage.setItem('ytos.pet.size', JSON.stringify(k)); } catch {} if (canSize) desk.setScale(k); };
  const setLocked = (v) => { setLockedS(v); try { localStorage.setItem('ytos.pet.locked', JSON.stringify(v)); } catch {} };
  useEffect(() => { if (canSize && size !== 1) desk.setScale(size); }, []);
  const wheel = (e) => { if (!canSize || !(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setSize(size + (e.deltaY < 0 ? .1 : -.1)); };
  const say = (t) => { setMsg(t); clearTimeout(say.t); say.t = setTimeout(() => setMsg(''), 2600); };
  // 按住拖 = 挪窗口；往上一甩 = 打开便签；不动 = 点了一下
  const drag = useRef(null);
  const down = (e) => { if (e.button !== 0 || e.target.closest('.pet-menu,.pet-pomo')) return; drag.current = { x: e.screenX, y: e.screenY, sx: e.screenX, sy: e.screenY, t: performance.now(), trail: [[performance.now(), e.screenX, e.screenY]] }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { const d = drag.current; if (!d) return; const dx = e.screenX - d.x, dy = e.screenY - d.y; if (!dx && !dy) return; d.x = e.screenX; d.y = e.screenY; d.trail.push([performance.now(), e.screenX, e.screenY]); if (d.trail.length > 12) d.trail.shift(); if (locked) return; d.moved = true; if (desk) desk.moveBy(dx, dy); setTilt(Math.max(-14, Math.min(14, -dx * 1.4))); clearTimeout(d.tt); d.tt = setTimeout(() => setTilt(0), 90); };
  const up = (e) => {
    const d = drag.current; drag.current = null; if (!d) return;
    const tx = e.screenX - d.sx, ty = e.screenY - d.sy, dt = performance.now() - d.t;
    if (Math.abs(tx) < 4 && Math.abs(ty) < 4) { setMenu((m) => !m); return; }
    if (locked) { if (Math.abs(tx) + Math.abs(ty) > 12) say('位置固定了，菜单里可以取消'); return; }
    setTilt(0); setBounce((b) => b + 1);
    // 甩：松手前那一小段往上走得很快（不是慢慢拖上去）
    const now = performance.now(); const tr = d.trail.filter(([t]) => now - t < 140); const [t0, x0, y0] = tr[0] || d.trail[0]; const vy = (e.screenY - y0) / Math.max(16, now - t0), vx = (e.screenX - x0) / Math.max(16, now - t0);
    if (ty < -40 && vy < -.55 && Math.abs(vx) < Math.abs(vy) && dt < 700) { if (desk) desk.moveBy(-tx, -ty); openSticky(); }
  };
  const openSticky = () => { if (window.sealonote && window.sealonote.showSticky) window.sealonote.showSticky(); else location.hash = '#/sticky'; say('便签打开啦'); };
  const remain = st.phase !== 'idle' ? pomo.remaining() : 0; const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const frac = total ? Math.min(1, Math.max(0, 1 - remain / total)) : 0; const C = 2 * Math.PI * 15;
  const item = (label, fn) => html`<button type="button" onClick=${() => { setMenu(false); fn(); }}>${label}</button>`;

  const Doll = html`<div class=${'pet-doll-w'} style=${`transform:rotate(${tilt}deg)`}><img key=${bounce} class=${'pet-doll' + (bounce ? ' drop' : '')} src=${frames ? frames[pose] || frames.idle : FALLBACK} alt="汤圆" draggable="false" /></div>`;
  if (bare) return Doll;
  if (preview) return html`<div class="pet preview"><div class="pet-say">${msg || '在下面给我换装吧'}</div><div class="pet-stage">${Doll}</div></div>`;
  return html`<div class=${'pet ' + (roomOn ? 'room-mode ' : '')} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onWheel=${wheel} onContextMenu=${(e) => { e.preventDefault(); setMenu(true); }}>
    ${st.phase !== 'idle' ? html`<button type="button" class=${'pet-pomo ' + st.phase + (st.paused ? ' paused' : '')} title=${st.paused ? '点一下继续' : '点一下暂停'} onClick=${() => (st.paused ? pomo.resume() : pomo.pause())}>
      <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true"><circle cx="18" cy="18" r="15" class="tr" /><circle cx="18" cy="18" r="15" class="fg" style=${`stroke-dasharray:${C};stroke-dashoffset:${C * (1 - frac)}`} /></svg>
      <b>${pomo.fmt(remain)}</b><small>${st.paused ? '暂停中' : st.phase === 'break' ? '休息' : (st.label || '专注').slice(0, 8)}</small>
    </button>` : msg ? html`<div class="pet-say">${msg}</div>` : html`<div class="pet-say ghost"></div>`}
    ${roomOn ? html`<${Room} room=${roomOf(s)} sealAt=${sealSpot(roomOf(s), st.phase === 'work' && !st.paused)}>${Doll}<//>` : html`<div class="pet-stage pet-hit">${Doll}</div>`}
    ${desk && html`<div class="pet-keys" title="只数按了几下，不记录按了什么">${keys.running || keys.today ? html`今天 <b>${(keys.today || 0).toLocaleString()}</b> 下` : keys.needsPermission ? '点我开启打字计数' : ''}</div>`}
    ${menu && html`<div class="pet-menu" onPointerDown=${(e) => e.stopPropagation()}>
      ${item('打开便签', openSticky)}
      ${st.phase === 'idle' ? item('专注 25 分钟', () => { pomo.start({ label: '专注' }); say('开始啦，我陪你'); }) : item(st.paused ? '继续番茄钟' : '暂停番茄钟', () => (st.paused ? pomo.resume() : pomo.pause()))}
      ${st.phase !== 'idle' && item('结束这一轮', () => pomo.stop())}
      ${item('和汤圆聊聊', () => (window.sealonote && window.sealonote.showAI ? window.sealonote.showAI() : (location.hash = '#/seal')))}
      ${item('换装…', () => (window.sealonote && window.sealonote.openMain ? window.sealonote.openMain('#/settings?sec=seal') : (location.hash = '#/settings?sec=seal')))}
      ${canSize && html`<div class="pet-size"><span>大小</span>${[[.7, '小'], [1, '中'], [1.3, '大'], [1.6, '特大']].map(([k, l]) => html`<button type="button" class=${Math.abs(size - k) < .05 ? 'on' : ''} onClick=${() => setSize(k)}>${l}</button>`)}</div>`}
      ${canRoom && item(roomOn ? '离开房间' : '汤圆的房间', toggleRoom)}
      ${item(locked ? '取消固定位置' : '固定在这里', () => { setLocked(!locked); say(locked ? '可以拖着我走啦' : '我就待在这儿'); })}
      ${desk && item(keys.on === false || keys.needsPermission ? '开启打字计数' : '关闭打字计数', async () => { const r = await desk.setCount(keys.on === false || keys.needsPermission); setKeys(r); if (r.needsPermission) say('在系统设置 → 隐私 → 辅助功能里允许 Sealonote'); })}
      ${item('打开 SealoNote', () => (window.sealonote && window.sealonote.openMain ? window.sealonote.openMain('') : (location.hash = '#/')))}
      ${desk && item('先收起来', () => desk.hide())}
    </div>`}
  </div>`;
}
