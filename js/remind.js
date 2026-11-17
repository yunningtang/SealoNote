// 待办的提醒：todo.reminders = [{ d: 提前几天（0 = 当天）, at: 'HH:MM' }]，到点弹一条系统通知（网页 / 桌面版都用浏览器的 Notification），
// 页面里同时出一条提示。每条提醒在这台设备上只响一次（记在 localStorage），超过 6 小时还没响到的就不补了，免得一打开电脑响一串。
// 另外两个小东西也放这里：一件事「不做了」（dropped）和「一段时间」（dueEnd）的判断，几个页面共用。
import { get, subscribe } from './store.js';
import { todayStr, addDays } from './util.js';

const KEY = 'ytos.rem.fired';
const WINDOW = 6 * 3600e3;
const pad = (n) => String(n).padStart(2, '0');
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 这件事落在 d 这一天吗：单日看 due，一段时间看 due…dueEnd
export const onDay = (t, d) => !!t.due && (t.due === d || (!!t.dueEnd && t.due <= d && d <= t.dueEnd));
// 「不做了」也算结束，但和「做完了」分开显示
export const isDropped = (t) => !!(t && t.done && t.dropped);

export const REMIND_PRESETS = [[0, '当天'], [1, '提前 1 天'], [3, '提前 3 天'], [7, '提前 1 周']];
export const remindLabel = (r) => `${r.d === 0 ? '当天' : r.d === 7 ? '提前 1 周' : `提前 ${r.d} 天`} ${r.at}`;
// 这条提醒具体在什么时候响
export function remindAt(t, r) {
  if (!t.due || !r || !/^\d\d:\d\d$/.test(r.at || '')) return null;
  const day = addDays(t.due, -(Number(r.d) || 0)); const [h, m] = r.at.split(':').map(Number);
  const [y, mo, da] = day.split('-').map(Number); return new Date(y, mo - 1, da, h, m, 0, 0);
}
export const remindText = (t, r) => { const at = remindAt(t, r); return at ? `${at.getMonth() + 1}月${at.getDate()}日 ${WD[at.getDay()]} ${pad(at.getHours())}:${pad(at.getMinutes())}` : ''; };

const readFired = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const writeFired = (m) => { try { const cut = Date.now() - 30 * 864e5; localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(m).filter(([, v]) => v > cut)))); } catch {} };

export async function askNotify() {
  try { if (typeof Notification === 'undefined') return 'unsupported'; if (Notification.permission === 'default') return await Notification.requestPermission(); return Notification.permission; } catch { return 'denied'; }
}

function ring(t, r, onToast) {
  const body = `${r.d === 0 ? '就是今天' : `${r.d} 天后到期`}${t.time ? ' · ' + t.time : ''}${t.note ? '\n' + t.note.slice(0, 80) : ''}`;
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(t.title, { body, tag: 'todo-' + t.id + '-' + r.d + '-' + r.at, icon: '/assets/icon-192.png' });
      n.onclick = () => { try { window.focus(); location.hash = '#/todos?open=' + t.id; n.close(); } catch {} };
    }
  } catch {}
  onToast && onToast(t, r);
}

export function checkReminders(onToast, now = Date.now()) {
  const fired = readFired(); let changed = false;
  for (const t of get().todos || []) {
    if (t.done || !t.due || !Array.isArray(t.reminders)) continue;
    for (const r of t.reminders) {
      const at = remindAt(t, r); if (!at) continue; const ms = at.getTime();
      const key = `${t.id}|${t.due}|${r.d}|${r.at}`;
      if (fired[key] || ms > now || now - ms > WINDOW) continue;
      fired[key] = now; changed = true; ring(t, r, onToast);
    }
  }
  if (changed) writeFired(fired);
}

let started = false;
export function startReminders(onToast) {
  if (started) return; started = true;
  const tick = () => checkReminders(onToast);
  setTimeout(tick, 2500); setInterval(tick, 30e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  let last = 0; subscribe(() => { const n = Date.now(); if (n - last > 5000) { last = n; tick(); } });
}
export const todayHas = (t) => onDay(t, todayStr());
