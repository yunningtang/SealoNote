// 数按键的小后台进程（Electron utilityProcess）：键盘钩子和它带来的所有事件都只在这里处理，
// 主进程和汤圆窗口完全不受影响。只数「按下了几下」，按的是哪个键不存、不传；按住不放（自动重复）只算一下。
// 每 0.15 秒把这段时间按了几下汇总发给主进程一次。
const { uIOhook } = require('uiohook-napi');

let n = 0;
const down = new Set();
uIOhook.on('keydown', (e) => { if (down.has(e.keycode)) return; down.add(e.keycode); n++; });
uIOhook.on('keyup', (e) => { down.delete(e.keycode); });

setInterval(() => { if (n) { process.parentPort.postMessage({ n }); n = 0; } }, 150);

process.parentPort.on('message', (e) => {
  if (e && e.data === 'stop') { try { uIOhook.stop(); } catch {} process.exit(0); }
});

try { uIOhook.start(); process.parentPort.postMessage({ ok: true }); }
catch (err) { process.parentPort.postMessage({ error: String((err && err.message) || err) }); }
