// 桌面汤圆（#/pet）：桌面版里一个透明的小窗口，汤圆坐在自己的小屋上。
//  · 你打字时它跟着拍鳍（只知道「按了一下」，不知道按了什么），下面写着今天敲了多少下
//  · 番茄钟在走时头顶有个计时环，点一下暂停 / 继续
//  · 按住拖：挪到桌面任何地方（可以固定住）；往上一甩：打开便签；点一下：菜单；Ctrl + 滚轮：变大变小
//  · 帽子、围巾、小屋在「设置 → 汤圆」里换，跟着账号同步
import { html, useState, useEffect, useRef } from '../../vendor/preact.js';
import { useStore, update } from '../store.js';
import { loadThree, buildSeal } from '../seal3d.js';
import * as pomo from '../pomo.js';

export const HATS = [['', '不戴'], ['beanie', '毛线帽'], ['bow', '蝴蝶结'], ['crown', '小皇冠'], ['phones', '耳机'], ['straw', '草帽'], ['party', '生日帽'], ['chef', '厨师帽'], ['bunny', '兔耳朵'], ['flowers', '花环'], ['cap', '鸭舌帽']];
export const NECKS = [['', '不戴'], ['bowtie', '领结'], ['bell', '小铃铛']];
export const SCARVES = [['', '不戴'], ['#d2524f', '红'], ['#4f7cf5', '蓝'], ['#4a9a6a', '绿'], ['#e0a23c', '黄'], ['#8a63c9', '紫']];
export const HOUSES = [['', '不要'], ['igloo', '冰屋'], ['cushion', '软垫'], ['desk', '书桌'], ['beach', '沙滩'], ['cloud', '云朵'], ['books', '书堆'], ['lily', '荷叶']];
export const petLook = (s) => ({ hat: '', scarf: '', neck: '', house: 'igloo', ...((s && s.settings && s.settings.pet) || {}) });
export const setPetLook = (patch) => update((d) => { d.settings.pet = { ...petLook(d), ...patch }; });

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
    const g = new THREE.Group(); g.position.set(0, top - .14, m.head.position.z - .05); g.rotation.x = -.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.5, .04, 8, 40), mat(0x5c9a52)); ring.rotation.x = Math.PI / 2; g.add(ring);
    const cols = [0xf2a7b8, 0xf6cf63, 0xffffff, 0xc9a7f0];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const f = new THREE.Group(); f.position.set(Math.sin(a) * .5, .04, Math.cos(a) * .5);
      for (let k = 0; k < 5; k++) { const pa = (k / 5) * Math.PI * 2; const pt = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 8), mat(cols[i % cols.length])); pt.position.set(Math.cos(pa) * .07, .02, Math.sin(pa) * .07); f.add(pt); }
      const c = new THREE.Mesh(new THREE.SphereGeometry(.045, 10, 8), mat(0xe8aa1c)); c.position.y = .04; f.add(c); g.add(f); }
    add(m.headPiv, g);
  } else if (look.hat === 'cap') {
    const navy = mat(0x2a4f9a);
    const g = new THREE.Group(); g.position.set(0, m.head.position.y, m.head.position.z); g.rotation.x = -.1;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(OUT, 40, 20, 0, Math.PI * 2, 0, Math.PI * .3), navy); g.add(dome);
    const bill = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .04, 32, 1, false, -Math.PI / 2, Math.PI), navy); bill.scale.set(1.3, 1, 1.25); bill.position.set(0, OUT * .66, OUT * .62); bill.rotation.x = .38; g.add(bill);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 8), mat(0xe03a6a)); btn.position.y = OUT; g.add(btn);
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

// 小屋：画在汤圆身后 / 身下的一张图（SVG），不进 3D
function House({ kind }) {
  if (kind === 'igloo') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><path d="M20 112 C20 40 200 40 200 112 Z" fill="#f4f8fc" stroke="#c9d6e3" stroke-width="2"/><path d="M38 78 H182 M28 96 H192 M60 60 H160 M80 60 V78 M140 60 V78 M60 78 V96 M110 78 V96 M160 78 V96 M85 96 V112 M135 96 V112" stroke="#d6e1ec" stroke-width="2" fill="none"/><path d="M86 112 C86 86 134 86 134 112 Z" fill="#cfdbe7"/></svg>`;
  if (kind === 'cushion') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><ellipse cx="110" cy="76.0" rx="96" ry="18" fill="#e8b4a4"/><ellipse cx="110" cy="70.0" rx="92" ry="16" fill="#f3c8b9"/><path d="M 40.0 70.0 Q 110.0 60.0 180.0 70.0" stroke="#e8b4a4" stroke-width="2" fill="none"/></svg>`;
  if (kind === 'desk') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><rect x="10" y="70.0" width="200" height="10" rx="3" fill="#b98a5e"/><rect x="22" y="80.0" width="8" height="14" fill="#9c7049"/><rect x="190" y="80.0" width="8" height="14" fill="#9c7049"/><rect x="160" y="34.0" width="4" height="36" fill="#6b6f78"/><path d="M 146.0 34.0 L 178.0 34.0 L 170.0 20.0 L 154.0 20.0 Z" fill="#f2c14e"/><rect x="24" y="58.0" width="34" height="12" rx="2" fill="#4f7cf5"/><rect x="28" y="48.0" width="28" height="10" rx="2" fill="#4a9a6a"/></svg>`;
  if (kind === 'beach') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><path d="M 0.0 74.0 Q 55.0 62.0 110.0 70.0 T 220.0 68.0 V 90.0 H 0.0 Z" fill="#f1dcae"/><path d="M 0.0 82.0 Q 40.0 74.0 80.0 80.0 T 160.0 78.0 T 220.0 80.0 V 90.0 H 0.0 Z" fill="#8ec9e8" opacity=".75"/><circle cx="186" cy="24" r="12" fill="#f6cf63" opacity=".8"/></svg>`;
  if (kind === 'cloud') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><path d="M30 86 C10 86 10 62 34 62 C36 44 66 40 76 54 C86 36 124 36 132 54 C146 42 176 46 178 64 C204 62 206 88 184 88 Z" fill="#fbfdff" stroke="#d8e4ef" stroke-width="2"/></svg>`;
  if (kind === 'books') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><rect x="38" y="70" width="144" height="14" rx="3" fill="#d2524f"/><rect x="46" y="84" width="132" height="14" rx="3" fill="#4f7cf5"/><rect x="32" y="98" width="152" height="14" rx="3" fill="#4a9a6a"/><path d="M42 74 H176 M50 88 H172 M36 102 H178" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></svg>`;
  if (kind === 'lily') return html`<svg class="pet-house" viewBox="0 0 220 120" aria-hidden="true"><ellipse cx="110" cy="84" rx="108" ry="22" fill="#8ec9e8" opacity=".45"/><ellipse cx="110" cy="72" rx="92" ry="17" fill="#6aa85a"/><path d="M110 72 L196 66 L194 76 Z" fill="#8ec9e8"/><path d="M110 72 L40 66 M110 72 L60 84 M110 72 L160 86" stroke="#4f8a43" stroke-width="1.5" opacity=".6"/><circle cx="40" cy="70" r="7" fill="#f2a7b8"/><circle cx="40" cy="70" r="3" fill="#f6cf63"/></svg>`;
  return null;
}

function usePomo() { const [st, set] = useState(pomo.get()); useEffect(() => pomo.subscribe((x) => set({ ...x })), []); const [, tick] = useState(0); useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []); return st; }

export default function Pet({ preview = false }) {
  const s = useStore(); const look = petLook(s);
  const desk = !preview && typeof window !== 'undefined' && window.sealonote && window.sealonote.pet;
  const cv = useRef(); const model = useRef(null); const three = useRef(null); const tapAt = useRef(0); const side = useRef(1);
  const [keys, setKeys] = useState({ today: 0, on: false, running: false, needsPermission: false });
  const [menu, setMenu] = useState(false); const [msg, setMsg] = useState('');
  const st = usePomo();

  // 3D 汤圆 + 动画：呼吸、眨眼、打字时左右鳍轮流拍；拖着走时往运动方向歪、被拉长一点，放下时弹一下
  // 显卡把 3D 画布收回（睡眠唤醒、换屏幕、显存紧张）时整个重建一遍——以前会只剩小屋、汤圆不见了
  const [glKey, setGlKey] = useState(0); const vel = useRef({ x: 0, y: 0 }); const dropAt = useRef(0);
  useEffect(() => {
    let dead = false, raf = 0, watch = 0; const el = cv.current;
    const rebuild = () => { if (!dead) setTimeout(() => setGlKey((k) => k + 1), 600); };
    const lost = (e) => { e.preventDefault(); cancelAnimationFrame(raf); rebuild(); };
    el && el.addEventListener('webglcontextlost', lost);
    loadThree().then((THREE) => {
      if (dead || !cv.current) return; three.current = THREE;
      let m; try { m = buildSeal(THREE, cv.current, 190); } catch { rebuild(); return; }
      model.current = m; dress(THREE, m, window.__petLook || look);
      m.seal.scale.setScalar(.84); m.seal.position.y = -.2; m.shadowMesh.position.y -= .2; // 给高帽子（厨师帽、兔耳朵）留出头顶的空间
      const gl = m.renderer.getContext(); watch = setInterval(() => { if (gl.isContextLost && gl.isContextLost()) { clearInterval(watch); rebuild(); } }, 4000);
      const t0 = performance.now(); let blinkAt = t0 + 2500; let tilt = 0, stretch = 0;
      const loop = (now) => {
        raf = requestAnimationFrame(loop); const t = (now - t0) / 1000;
        const since = (now - tapAt.current) / 1000; const tap = Math.max(0, 1 - since * 6); // 按一下键，拍一下，0.16 秒落回来
        // 拖动：速度越快歪得越多（平滑跟随）；放下：阻尼弹簧，弹两下停住
        const v = vel.current; v.x *= .86; v.y *= .86;
        tilt += (Math.max(-.45, Math.min(.45, -v.x * .025)) - tilt) * .2; stretch += (Math.min(.18, Math.abs(v.y) * .006) - stretch) * .2;
        const ds = (now - dropAt.current) / 1000; const bounce = dropAt.current && ds < 1.2 ? Math.exp(-ds * 5) * Math.sin(ds * 22) : 0;
        m.rig.position.y = Math.sin(t * 1.6) * .03 + tap * .06 + bounce * .12;
        m.rig.rotation.z = tilt; m.rig.scale.set(1 - stretch * .5 - bounce * .05, 1 + stretch + bounce * .08, 1);
        m.headPiv.rotation.z = Math.sin(t * .7) * .04 + side.current * tap * .08;
        m.flips.forEach(({ piv, sx }) => { const mine = sx === side.current ? tap : 0; piv.rotation.z = sx * -.22 + sx * mine * .9 + (Math.abs(tilt) > .05 ? sx * Math.abs(tilt) * .8 : 0); });
        m.tailPiv.rotation.y = Math.sin(t * 2.2) * .18 + tilt * .8;
        if (now > blinkAt) { const k = (now - blinkAt) / 120; const sy = k < 1 ? 1 - k : k < 2 ? k - 1 : 1; m.eyes.forEach((e) => { e.scale.y = Math.max(.08, sy); }); if (k >= 2) { blinkAt = now + 2200 + Math.random() * 3500; m.eyes.forEach((e) => { e.scale.y = 1; }); } }
        m.renderer.render(m.scene, m.camera);
      };
      raf = requestAnimationFrame(loop);
    }).catch(() => rebuild());
    return () => { dead = true; cancelAnimationFrame(raf); clearInterval(watch); el && el.removeEventListener('webglcontextlost', lost); if (model.current) { model.current.dispose(); model.current = null; } };
  }, [glKey]);
  // 换装：设置一变就重新穿
  const lookKey = JSON.stringify(look);
  useEffect(() => { window.__petLook = look; if (model.current && three.current) dress(three.current, model.current, look); }, [lookKey]);

  // 按键次数（只有桌面版有）
  useEffect(() => {
    if (!desk) return;
    desk.stats().then(setKeys).catch(() => {});
    return desk.onKey((v) => { tapAt.current = performance.now(); side.current = -side.current; setKeys((k) => ({ ...k, today: v.today, running: true })); });
  }, []);
  // 网页里预览时：在这个页面里打字也会拍
  useEffect(() => { if (desk || !preview) return; const h = () => { tapAt.current = performance.now(); side.current = -side.current; }; addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, []);

  // 大小 / 固定位置：每台电脑自己记（屏幕不一样）
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const [size, setSizeS] = useState(() => ls('ytos.pet.size', 1)); const [locked, setLockedS] = useState(() => ls('ytos.pet.locked', false));
  const canSize = !!(desk && desk.setScale);
  const setSize = (k) => { k = Math.max(.6, Math.min(1.8, Math.round(k * 10) / 10)); setSizeS(k); try { localStorage.setItem('ytos.pet.size', JSON.stringify(k)); } catch {} if (canSize) desk.setScale(k); };
  const setLocked = (v) => { setLockedS(v); try { localStorage.setItem('ytos.pet.locked', JSON.stringify(v)); } catch {} };
  useEffect(() => { if (canSize && size !== 1) desk.setScale(size); }, []);
  const wheel = (e) => { if (!canSize || !(e.ctrlKey || e.metaKey)) return; e.preventDefault(); setSize(size + (e.deltaY < 0 ? .1 : -.1)); };
  const say = (t) => { setMsg(t); clearTimeout(say.t); say.t = setTimeout(() => setMsg(''), 2600); };
  // 按住拖 = 挪窗口；往上一甩 = 打开便签；不动 = 点了一下
  const drag = useRef(null);
  const down = (e) => { if (e.button !== 0 || e.target.closest('.pet-menu,.pet-pomo')) return; drag.current = { x: e.screenX, y: e.screenY, sx: e.screenX, sy: e.screenY, t: performance.now(), trail: [[performance.now(), e.screenX, e.screenY]] }; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { const d = drag.current; if (!d) return; const dx = e.screenX - d.x, dy = e.screenY - d.y; if (!dx && !dy) return; d.x = e.screenX; d.y = e.screenY; d.trail.push([performance.now(), e.screenX, e.screenY]); if (d.trail.length > 12) d.trail.shift(); if (locked) return; d.moved = true; vel.current = { x: vel.current.x * .5 + dx, y: vel.current.y * .5 + dy }; if (desk) desk.moveBy(dx, dy); };
  const up = (e) => {
    const d = drag.current; drag.current = null; if (!d) return;
    const tx = e.screenX - d.sx, ty = e.screenY - d.sy, dt = performance.now() - d.t;
    if (Math.abs(tx) < 4 && Math.abs(ty) < 4) { setMenu((m) => !m); return; }
    if (locked) { if (Math.abs(tx) + Math.abs(ty) > 12) say('位置固定了，菜单里可以取消'); return; }
    dropAt.current = performance.now();
    // 甩：松手前那一小段往上走得很快（不是慢慢拖上去）
    const now = performance.now(); const tr = d.trail.filter(([t]) => now - t < 140); const [t0, x0, y0] = tr[0] || d.trail[0]; const vy = (e.screenY - y0) / Math.max(16, now - t0), vx = (e.screenX - x0) / Math.max(16, now - t0);
    if (ty < -40 && vy < -.55 && Math.abs(vx) < Math.abs(vy) && dt < 700) { if (desk) desk.moveBy(-tx, -ty); tapAt.current = performance.now(); openSticky(); }
  };
  const openSticky = () => { if (window.sealonote && window.sealonote.showSticky) window.sealonote.showSticky(); else location.hash = '#/sticky'; say('便签打开啦'); };
  const remain = st.phase !== 'idle' ? pomo.remaining() : 0; const total = (st.phase === 'break' ? st.breakLen : st.workLen) * 60; const frac = total ? Math.min(1, Math.max(0, 1 - remain / total)) : 0; const C = 2 * Math.PI * 15;
  const item = (label, fn) => html`<button type="button" onClick=${() => { setMenu(false); fn(); }}>${label}</button>`;

  if (preview) return html`<div class=${'pet preview ' + (look.house ? 'has-house house-' + look.house : '')}><div class="pet-say">${msg || '在下面给我换装吧'}</div><div class="pet-stage"><${House} kind=${look.house} /><canvas key=${glKey} ref=${cv} width="190" height="190"></canvas></div></div>`;
  return html`<div class=${'pet ' + (look.house ? 'has-house house-' + look.house : '')} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onWheel=${wheel} onContextMenu=${(e) => { e.preventDefault(); setMenu(true); }}>
    ${st.phase !== 'idle' ? html`<button type="button" class=${'pet-pomo ' + st.phase + (st.paused ? ' paused' : '')} title=${st.paused ? '点一下继续' : '点一下暂停'} onClick=${() => (st.paused ? pomo.resume() : pomo.pause())}>
      <svg viewBox="0 0 36 36" width="34" height="34" aria-hidden="true"><circle cx="18" cy="18" r="15" class="tr" /><circle cx="18" cy="18" r="15" class="fg" style=${`stroke-dasharray:${C};stroke-dashoffset:${C * (1 - frac)}`} /></svg>
      <b>${pomo.fmt(remain)}</b><small>${st.paused ? '暂停中' : st.phase === 'break' ? '休息' : (st.label || '专注').slice(0, 8)}</small>
    </button>` : msg ? html`<div class="pet-say">${msg}</div>` : html`<div class="pet-say ghost"></div>`}
    <div class="pet-stage"><${House} kind=${look.house} /><canvas key=${glKey} ref=${cv} width="190" height="190"></canvas></div>
    ${desk && html`<div class="pet-keys" title="只数按了几下，不记录按了什么">${keys.running || keys.today ? html`今天 <b>${(keys.today || 0).toLocaleString()}</b> 下` : keys.needsPermission ? '点我开启打字计数' : ''}</div>`}
    ${menu && html`<div class="pet-menu" onPointerDown=${(e) => e.stopPropagation()}>
      ${item('打开便签', openSticky)}
      ${st.phase === 'idle' ? item('专注 25 分钟', () => { pomo.start({ label: '专注' }); say('开始啦，我陪你'); }) : item(st.paused ? '继续番茄钟' : '暂停番茄钟', () => (st.paused ? pomo.resume() : pomo.pause()))}
      ${st.phase !== 'idle' && item('结束这一轮', () => pomo.stop())}
      ${item('和汤圆聊聊', () => (window.sealonote && window.sealonote.showAI ? window.sealonote.showAI() : (location.hash = '#/seal')))}
      ${item('换装和小屋…', () => (window.sealonote && window.sealonote.openMain ? window.sealonote.openMain('#/settings?sec=seal') : (location.hash = '#/settings?sec=seal')))}
      ${canSize && html`<div class="pet-size"><span>大小</span>${[[.7, '小'], [1, '中'], [1.3, '大'], [1.6, '特大']].map(([k, l]) => html`<button type="button" class=${Math.abs(size - k) < .05 ? 'on' : ''} onClick=${() => setSize(k)}>${l}</button>`)}</div>`}
      ${item(locked ? '取消固定位置' : '固定在这里', () => { setLocked(!locked); say(locked ? '可以拖着我走啦' : '我就待在这儿'); })}
      ${desk && item(keys.on === false || keys.needsPermission ? '开启打字计数' : '关闭打字计数', async () => { const r = await desk.setCount(keys.on === false || keys.needsPermission); setKeys(r); if (r.needsPermission) say('在系统设置 → 隐私 → 辅助功能里允许 Sealonote'); })}
      ${item('打开 SealoNote', () => (window.sealonote && window.sealonote.openMain ? window.sealonote.openMain('') : (location.hash = '#/')))}
      ${desk && item('先收起来', () => desk.hide())}
    </div>`}
  </div>`;
}
