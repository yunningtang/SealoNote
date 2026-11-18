// 数按键的小后台进程（Electron utilityProcess）：键盘钩子和它带来的所有事件都只在这里处理，
// 主进程和汤圆窗口完全不受影响。只数「按下了几下」，按的是哪个键不存、不传。
// 每 0.15 秒把这段时间按了几下汇总发给主进程一次。
//
// 「按住不放只算一下」：系统按住键时会一直重复发 keydown（大约每 30–50 毫秒一次）。
// 不能只靠「有没有收到 keyup」来判断：锁屏（Win+L）、睡眠、UAC 弹窗、切换桌面时 keyup 常常收不到，
// 那个键就会被当成一直按着、以后再也不算（BongoCat 的 #47 就是这个问题）。
// 所以：同一个键 1 秒内又来 keydown 才算「按住的重复」；超过 1 秒没动静，下一次按下照常算一下。
// 主进程在锁屏 / 睡眠 / 解锁时也会发 reset，把记着的状态全部清掉。
const { uIOhook } = require('uiohook-napi');

const REPEAT_MS = 1000;
let n = 0;
const held = new Map(); // keycode → 上一次 keydown 的时间

uIOhook.on('keydown', (e) => {
  const now = Date.now(); const last = held.get(e.keycode);
  held.set(e.keycode, now);
  if (last && now - last < REPEAT_MS) return; // 按住的自动重复
  n++;
});
uIOhook.on('keyup', (e) => { held.delete(e.keycode); });

setInterval(() => {
  if (n) { process.parentPort.postMessage({ n }); n = 0; }
  // 顺手把太久没动静的键清掉（漏掉的 keyup）
  const now = Date.now(); for (const [k, t] of held) if (now - t > REPEAT_MS * 3) held.delete(k);
}, 150);

process.parentPort.on('message', (e) => {
  const m = e && e.data;
  if (m === 'reset') held.clear();
  if (m === 'stop') { try { uIOhook.stop(); } catch {} process.exit(0); }
});

try { uIOhook.start(); process.parentPort.postMessage({ ok: true }); }
catch (err) { process.parentPort.postMessage({ error: String((err && err.message) || err) }); }
