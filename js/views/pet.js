// 桌面汤圆（#/pet）：桌面版里一个透明的小窗口，汤圆坐在自己的小屋上。
//  · 你打字时它跟着拍鳍（只知道「按了一下」，不知道按了什么），下面写着今天敲了多少下
//  · 番茄钟在走时头顶有个计时环，点一下暂停 / 继续
//  · 按住拖：挪到桌面任何地方（可以固定住）；往上一甩：打开便签；点一下：菜单；Ctrl + 滚轮：变大变小
//  · 帽子、围巾、小屋在「设置 → 汤圆」里换，跟着账号同步
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { loadThree, buildSeal } from '../seal3d.js';
import * as pomo from '../pomo.js';
import { Icon } from '../ui.js';

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
const framesCache = new Map(); let snapQ = Promise.resolve(null); const FRAME_V = 2;
export const FALLBACK = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path d="M16 96 C12 64 32 34 60 34 C88 34 108 64 104 96 C102 108 84 112 60 112 C36 112 18 108 16 96 Z" fill="#eef0f3" stroke="#d3d2cd" stroke-width="1.5"/><circle cx="44" cy="72" r="5" fill="#1f1e1c"/><circle cx="76" cy="72" r="5" fill="#1f1e1c"/></svg>');
export function snapFrames(look) {
  const key = JSON.stringify(look); if (framesCache.has(key)) return Promise.resolve(framesCache.get(key));
  // 上次拍好的存在这台电脑上：打开桌面版时汤圆马上出现，不用等重拍（模型改了就换 FRAME_V）
  try { const c = JSON.parse(localStorage.getItem('ytos.pet.frames') || 'null'); if (c && c.v === FRAME_V && c.key === key && c.f && c.f.idle) { framesCache.set(key, c.f); return Promise.resolve(c.f); } } catch {}
  snapQ = snapQ.catch(() => null).then(async () => {
    if (framesCache.has(key)) return framesCache.get(key);
    const THREE = await loadThree(); const cv = document.createElement('canvas'); cv.width = cv.height = 190;
    let m; try { m = buildSeal(THREE, cv, 190); } catch { return null; }
    try {
      m.renderer.setPixelRatio(Math.min(3, Math.max(2, window.devicePixelRatio || 1))); m.renderer.setSize(190, 190, false);
      dress(THREE, m, look); m.seal.scale.setScalar(.84); m.seal.position.y = -.2; m.shadowMesh.position.y -= .2; // 给高帽子留出头顶的空间
      const base = () => { m.rig.position.y = 0; m.headPiv.rotation.z = 0; m.tailPiv.rotation.y = 0; m.flips.forEach(({ piv, sx }) => { piv.rotation.z = sx * -.22; }); m.eyes.forEach((e) => { e.scale.y = 1; }); };
      // 每张先画到 2D 画布上，最后按所有姿势合起来的范围把四周空白裁掉：气泡、计时就能贴着汤圆头顶（戴高帽子也一样）
      const pr = m.renderer.getPixelRatio(); const shots = {};
      const shot = (name) => { m.renderer.render(m.scene, m.camera); const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(cv, 0, 0); shots[name] = c; };
      base(); shot('idle');
      base(); m.eyes.forEach((e) => { e.scale.y = .08; }); shot('blink');
      for (const [name, sd] of [['left', -1], ['right', 1]]) { base(); m.rig.position.y = .05; m.headPiv.rotation.z = sd * .08; m.tailPiv.rotation.y = sd * .15; m.flips.forEach(({ piv, sx }) => { piv.rotation.z = sx * -.22 + (sx === sd ? sx * .9 : 0); }); shot(name); }
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const c of Object.values(shots)) { const { data, width: w, height: h } = c.getContext('2d').getImageData(0, 0, c.width, c.height); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (x1 < 0) { x0 = y0 = 0; x1 = cv.width - 1; y1 = cv.height - 1; }
      const pad = Math.round(4 * pr); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width - 1, x1 + pad); y1 = Math.min(cv.height - 1, y1 + pad);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1; const f = { w: Math.round(cw / pr), h: Math.round(ch / pr) };
      for (const [name, c] of Object.entries(shots)) { const o = document.createElement('canvas'); o.width = cw; o.height = ch; o.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch); f[name] = o.toDataURL('image/png'); }
      framesCache.set(key, f); try { localStorage.setItem('ytos.pet.frames', JSON.stringify({ v: FRAME_V, key, f })); } catch {} return f;
    } finally { try { m.dispose(); m.renderer.forceContextLoss(); } catch {} }
  });
  return snapQ;
}

function usePomo() { const [st, set] = useState(pomo.get()); useEffect(() => pomo.subscribe((x) => set({ ...x })), []); const [, tick] = useState(0); const live = st.phase && st.phase !== 'idle' && !st.paused; useEffect(() => { if (!live) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [live]); return st; } // 没在计时就不每秒刷新（空闲时 CPU 接近 0）

export default function Pet({ preview = false, bare = false }) {
  const s = useStore(); const look = petLook(s);
  const desk = !preview && typeof window !== 'undefined' && window.sealonote && window.sealonote.pet;
  const fits = !!(desk && desk.fit); // 0.6.4 起：窗口刚好包住内容，不用点击穿透
  const st = usePomo();
  const [keys, setKeys] = useState({ today: 0, on: false, running: false, needsPermission: false });
  const [panel, setPanel] = useState(false); const [hover, setHover] = useState(false); const [msg, setMsg] = useState('');
  const say = (t, ms = 2800) => { setMsg(t); clearTimeout(say.t); say.t = setTimeout(() => setMsg(''), ms); };

  // ---- 汤圆的样子：几张定格画（见 snapFrames），四张都放在页面里、只切换哪张看得见：换姿势不用重新解码图片
  const lookKey = JSON.stringify(look);
  const [frames, setFrames] = useState(() => framesCache.get(lookKey) || (() => { try { const c = JSON.parse(localStorage.getItem('ytos.pet.frames') || 'null'); return c && c.v === FRAME_V && c.key === lookKey ? c.f : null; } catch { return null; } })());
  useEffect(() => { let dead = false; snapFrames(look).then((f) => { if (!dead && f) setFrames(f); }); return () => { dead = true; }; }, [lookKey]);
  const [pose, setPose] = useState('idle'); const poseT = useRef(0); const side = useRef(1);
  useEffect(() => { let t; const blink = () => { t = setTimeout(() => { if (!poseT.current) { setPose('blink'); setTimeout(() => setPose((p) => (p === 'blink' ? 'idle' : p)), 140); } blink(); }, 2600 + Math.random() * 3800); }; blink(); return () => clearTimeout(t); }, []);
  const flap = () => { side.current = -side.current; setPose(side.current > 0 ? 'right' : 'left'); clearTimeout(poseT.current); poseT.current = setTimeout(() => { poseT.current = 0; setPose('idle'); }, 120); };
  const [tilt, setTilt] = useState(0); const [hop, setHop] = useState(0);

  // ---- 打字：数字最多每 0.4 秒刷新一次；停下来 4 秒后数字淡下去
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!desk) return; desk.stats().then(setKeys).catch(() => {});
    let last = 0, pend = 0, idle = 0; const show = (v) => { last = performance.now(); setKeys((k) => ({ ...k, today: v.today, running: true })); };
    return desk.onKey((v) => { flap(); setTyping(true); clearTimeout(idle); idle = setTimeout(() => setTyping(false), 4000); const now = performance.now(); clearTimeout(pend); if (now - last > 400) show(v); else pend = setTimeout(() => show(v), 400); });
  }, []);
  useEffect(() => { if (desk || !preview) return; addEventListener('keydown', flap); return () => removeEventListener('keydown', flap); }, []);

  // ---- 0.6.3 的桌面版还开着点击穿透：只有那一版才需要告诉它鼠标在不在汤圆身上
  useEffect(() => {
    if (!desk || fits || !desk.setHit) return; let on = null; const set = (v) => { if (v !== on) { on = v; desk.setHit(v); } };
    const mv = (e) => { if (drag.current) { set(true); return; } const el = document.elementFromPoint(e.clientX, e.clientY); set(!!(el && el.closest('.pet-doll,.pet-bar,.pet-panel,.pet-chip,.pet-bubble,.room-svg'))); };
    addEventListener('mousemove', mv); set(false); return () => removeEventListener('mousemove', mv);
  }, []);

  // ---- 鼠标在不在汤圆身上：看鼠标真正在哪（只靠 mouseleave 的话，点过按钮以后有时收不到，按钮条就一直挂着）
  useEffect(() => {
    let cur = false; const set = (v) => { if (v !== cur) { cur = v; setHover(v); } };
    const mv = (e) => set(!!(e.target && e.target.closest && e.target.closest('.pet')));
    const out = () => set(false);
    addEventListener('mousemove', mv, { passive: true }); document.documentElement.addEventListener('mouseleave', out); addEventListener('blur', out);
    return () => { removeEventListener('mousemove', mv); document.documentElement.removeEventListener('mouseleave', out); removeEventListener('blur', out); };
  }, []);
  // ---- 窗口刚好包住内容：内容大小一变就告诉桌面版
  const box = useRef();
  useEffect(() => {
    if (!fits || !box.current) return; let t = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(() => { const r = box.current.getBoundingClientRect(); desk.fit(Math.ceil(r.width), Math.ceil(r.height)); }); });
    ro.observe(box.current); return () => { ro.disconnect(); cancelAnimationFrame(t); };
  }, []);

  // ---- 每台电脑自己记：大小、固定位置、房间
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const [size, setSizeS] = useState(() => ls('ytos.pet.size', 1)); const [locked, setLockedS] = useState(() => ls('ytos.pet.locked', false));
  const canSize = !!(desk && desk.setScale);
  const roomOn = false; // 小屋已经去掉了
  useEffect(() => { if (canSize && size !== 1) desk.setScale(size); if (desk && desk.setRoom && ls('ytos.pet.room', false)) { desk.setRoom(false); lsSet('ytos.pet.room', false); } }, []); // 以前开着小屋的：窗口变回汤圆大小
  const setSize = (k) => { k = Math.max(.6, Math.min(1.8, Math.round(k * 10) / 10)); setSizeS(k); lsSet('ytos.pet.size', k); if (canSize) desk.setScale(k); };
  const wheel = (e) => { if (!canSize || !(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setSize(size + (e.deltaY < 0 ? .1 : -.1)); };

  // ---- 点一下汤圆：蹦一下，说一句有用的（番茄钟还剩多久 / 今天下一件事 / 打个招呼）
  const poke = () => {
    setHop((h) => h + 1); flap();
    if (st.phase !== 'idle') { say(st.paused ? '番茄钟暂停着，点上面的计时继续' : `还有 ${pomo.fmt(pomo.remaining())}，加油`); return; }
    const today = new Date(); const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const next = (s.todos || []).filter((t) => !t.done && t.due && t.due <= d).sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || String(a.time || '99').localeCompare(String(b.time || '99')))[0];
    say(next ? `下一件：${next.title.slice(0, 18)}${next.time ? ' · ' + next.time : ''}` : ['今天的事都做完啦', '我在这儿陪你', '要不要专注一会儿？'][Math.floor(Math.random() * 3)]);
  };

  // ---- 拖动：按下后挪动超过 4 像素才算拖；0.6.4 起由桌面版跟着鼠标挪窗口（顺滑），旧版每动一下发一次
  const drag = useRef(null);
  const down = (e) => { if (e.button !== 0 || e.target.closest('.pet-bar,.pet-panel,.pet-chip')) return; drag.current = { sx: e.screenX, sy: e.screenY, x: e.screenX, y: e.screenY, t: performance.now(), on: false, trail: [[performance.now(), e.screenX, e.screenY]], ox: e.screenX - window.screenX, oy: e.screenY - window.screenY }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => {
    const d = drag.current; if (!d) return; const dx = e.screenX - d.x, dy = e.screenY - d.y; d.x = e.screenX; d.y = e.screenY; d.trail.push([performance.now(), e.screenX, e.screenY]); if (d.trail.length > 12) d.trail.shift();
    if (!d.on && Math.abs(e.screenX - d.sx) + Math.abs(e.screenY - d.sy) < 5) return;
    if (locked) return;
    if (!d.on) { d.on = true; setPanel(false); if (desk && desk.dragStart) desk.dragStart(d.ox, d.oy); }
    if (desk && !desk.dragStart) desk.moveBy(dx, dy);
    setTilt(Math.max(-12, Math.min(12, -dx * 1.2))); clearTimeout(d.tt); d.tt = setTimeout(() => setTilt(0), 90);
  };
  const up = (e) => {
    const d = drag.current; drag.current = null; if (!d) return; if (d.on && desk && desk.dragEnd) desk.dragEnd(); setTilt(0);
    if (!d.on) { if (Math.abs(e.screenX - d.sx) + Math.abs(e.screenY - d.sy) > 12 && locked) say('位置固定了，在「更多」里可以取消'); else poke(); return; }
    setHop((h) => h + 1);
    const tx = e.screenX - d.sx, ty = e.screenY - d.sy, now = performance.now(); const tr = d.trail.filter(([t]) => now - t < 140); const [t0, x0, y0] = tr[0] || d.trail[0]; const vy = (e.screenY - y0) / Math.max(16, now - t0), vx = (e.screenX - x0) / Math.max(16, now - t0);
    if (ty < -40 && vy < -.55 && Math.abs(vx) < Math.abs(vy) && now - d.t < 700 && desk) { desk.moveBy(-tx, -ty); openSticky(); }
  };
  const openSticky = () => { if (window.sealonote && window.sealonote.showSticky) window.sealonote.showSticky(); else location.hash = '#/sticky'; say('便签打开啦'); };
  const openMain = (h) => (window.sealonote && window.sealonote.openMain ? window.sealonote.openMain(h) : (location.hash = h || '#/'));

  // ---- 画面
  // 一轮结束：跳一下、说一句（提示音番茄钟自己会响）。用完成次数变了来判断，手动「结束这一轮」不算
  const prevPomo = useRef({ phase: st.phase, count: st.count });
  useEffect(() => {
    const p = prevPomo.current; prevPomo.current = { phase: st.phase, count: st.count };
    if (preview) return;
    if (st.count > p.count) { setHop((h) => h + 1); say(st.phase === 'break' ? `完成一轮啦！休息 ${st.breakLen} 分钟` : '完成一轮啦！', 6000); }
    else if (p.phase === 'break' && st.phase === 'idle') { setHop((h) => h + 1); say('休息好了，再来一轮？', 6000); }
  }, [st.phase, st.count]);
  // 第一次见面：告诉你可以怎么玩（只说一次）
  useEffect(() => { if (preview || bare || !frames || (() => { try { return JSON.parse(localStorage.getItem('ytos.pet.intro')); } catch { return false; } })()) return; lsSet('ytos.pet.intro', true); const t = setTimeout(() => say('点我看下一件事，拖我换地方\n往上一甩就打开便签', 8000), 600); return () => clearTimeout(t); }, [!!frames]);
  const pomoOn = st.phase !== 'idle'; const remain = pomoOn ? pomo.remaining() : 0; const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const frac = total ? Math.min(1, Math.max(0, 1 - remain / total)) : 0; const C = 2 * Math.PI * 9;
  const doll = html`<div class="pet-doll-w" style=${`transform:rotate(${tilt}deg)`}><div key=${hop} class=${'pet-doll' + (hop ? ' hop' : '')} style=${frames && frames.w ? `width:${frames.w}px;height:${frames.h}px;aspect-ratio:${frames.w}/${frames.h}` : 'width:150px;height:110px;aspect-ratio:150/110'}>
    ${frames ? ['idle', 'blink', 'left', 'right'].map((k) => html`<img key=${k} src=${frames[k]} class=${pose === k ? 'on' : ''} alt="" draggable="false" />`) : html`<img src=${FALLBACK} class="on" alt="" draggable="false" />`}
  </div></div>`;
  if (bare) return doll;
  if (preview) return html`<div class="pet preview"><div class="pet-bubble">${msg || '在下面给我换装吧'}</div><div class="pet-stage">${doll}</div></div>`;

  const toggleLock = () => { const v = !locked; setLockedS(v); lsSet('ytos.pet.locked', v); say(v ? '我就待在这儿' : '可以拖着我走啦'); };
  const toggleCount = async () => { const r = await desk.setCount(keys.on === false || keys.needsPermission); setKeys(r); if (r.needsPermission) say('在系统设置 → 隐私 → 辅助功能里允许 Sealonote', 5000); else if (r.wayland || r.error === 'wayland') say('Wayland 桌面不允许读键盘，打字计数用不了（X11 可以）', 5000); else if (r.error === 'crashed') say('打字计数连续出错停下了，重启 Sealonote 再试', 5000); };
  // 桌面版：「更多」和右键都弹系统菜单（窗口不变大、不挡汤圆）；网页预览 / 旧版桌面没有就用页面里的面板
  const counting = !!desk && keys.on !== false && !keys.needsPermission;
  const more = async () => {
    if (!(desk && desk.menu)) { setPanel((x) => !x); return; }
    const id = await desk.menu({ size, locked, counting });
    if (id === 'dress') openMain('#/settings?sec=seal');
    else if (id && id.startsWith('size:')) setSize(+id.slice(5));
    else if (id === 'lock') toggleLock();
    else if (id === 'count') toggleCount();
    else if (id === 'hide') desk.hide();
  };
  const btn = (icon, title, fn, on, short) => html`<button type="button" class=${'pb' + (on ? ' on' : '')} data-l=${short || title} aria-label=${title} onClick=${(e) => { e.stopPropagation(); fn(); }}><${Icon} name=${icon} size=${15} /></button>`;
  const bar = html`<div class="pet-bar">
    ${btn('note', '打开便签', openSticky, false, '便签')}
    ${pomoOn ? btn(st.paused ? 'play' : 'pause', st.paused ? '继续番茄钟' : '暂停番茄钟', () => (st.paused ? pomo.resume() : pomo.pause()), false, st.paused ? '继续' : '暂停') : btn('clock', '专注 25 分钟', () => { pomo.start({ label: '专注' }); say('开始啦，我陪你'); }, false, '专注')}
    ${btn('chat', '和汤圆聊聊', () => (window.sealonote && window.sealonote.showAI ? window.sealonote.showAI() : (location.hash = '#/seal')), false, '聊天')}
    ${btn('dots', '更多', more, panel, '更多')}
  </div>`;
  const timer = pomoOn && html`<button type="button" class=${'pet-chip pet-timer ' + st.phase + (st.paused ? ' paused' : '')} title=${st.paused ? '点一下继续' : '点一下暂停'} onClick=${(e) => { e.stopPropagation(); st.paused ? pomo.resume() : pomo.pause(); }}>
    <svg viewBox="0 0 22 22" width="19" height="19" aria-hidden="true"><circle cx="11" cy="11" r="9" class="tr" /><circle cx="11" cy="11" r="9" class="fg" style=${`stroke-dasharray:${C};stroke-dashoffset:${C * (1 - frac)}`} /></svg>
    <b>${pomo.fmt(remain)}</b><small>${st.paused ? '暂停' : st.phase === 'break' ? '休息' : '专注'}</small></button>`;
  // 头顶这一格：鼠标在汤圆身上时是一排按钮，不然是计时 / 说的话
  // 刚说了话就先显示那句话（点了汤圆要看到它回答），说完了鼠标还在上面才换成按钮
  const top = msg ? html`<div class="pet-bubble">${msg}</div>` : hover && !panel ? bar : timer || html`<div class="pet-slot"></div>`;
  const row = (label, fn, hint) => html`<button type="button" class="pp-row" onClick=${() => { setPanel(false); fn(); }}><span>${label}</span>${hint && html`<small>${hint}</small>`}</button>`;
  return html`<div ref=${box} class=${'pet ' + (roomOn ? 'room-mode ' : '') + (fits ? 'fit ' : '')} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onWheel=${wheel} onContextMenu=${(e) => { e.preventDefault(); if (desk && desk.menu) more(); else setPanel(true); }} onDblClick=${() => openMain('')}>
    ${panel && html`<div class="pet-panel" onPointerDown=${(e) => e.stopPropagation()}>
      ${pomoOn && html`${pomoOn && row('结束这一轮', () => pomo.stop())}<div class="pp-sep"></div>`}
      ${row('换装…', () => openMain('#/settings?sec=seal'))}
      ${canSize && html`<div class="pp-size"><span>大小</span><div>${[[.7, '小'], [1, '中'], [1.3, '大'], [1.6, '特大']].map(([k, l]) => html`<button type="button" class=${Math.abs(size - k) < .05 ? 'on' : ''} onClick=${() => setSize(k)}>${l}</button>`)}</div></div>`}
      <div class="pp-sep"></div>
      ${row(locked ? '取消固定' : '固定在这里', toggleLock)}
      ${desk && row(keys.on === false || keys.needsPermission ? '开启打字计数' : '关闭打字计数', toggleCount)}
      <div class="pp-sep"></div>
      ${desk && row('收起汤圆', () => desk.hide())}
    </div>`}
    <div class="pet-top">${top}</div>
    <div class="pet-stage">${doll}</div>
    ${desk && html`<div class=${'pet-count' + (typing || hover ? ' on' : '')} title="只数按了几下，不记录按了什么">${keys.running || keys.today ? html`今天 <b>${(keys.today || 0).toLocaleString()}</b> 下` : keys.needsPermission ? '点「更多」开启打字计数' : ''}</div>`}
  </div>`;
}
