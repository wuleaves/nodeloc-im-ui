import { NOTIF_STRIP_OPEN_KEY } from "../config/constants.js";

/** 通知分类栏默认展开；用户手动收起后记忆状态。 */
export function isNotifStripExpanded() {
  try {
    const saved = localStorage.getItem(NOTIF_STRIP_OPEN_KEY);
    return saved == null ? true : saved === "1";
  } catch {
    return true;
  }
}

function applyNotifStripContext(active, expanded = isNotifStripExpanded()) {
  const root = document.documentElement;
  const show = !!active && !!expanded;
  const changed =
    root.classList.contains("im-notif-strip-active") !== !!active ||
    root.classList.contains("im-notif-strip-expanded") !== show;
  root.classList.toggle("im-notif-strip-active", !!active);
  root.classList.toggle("im-notif-strip-expanded", show);
  if (changed) window.dispatchEvent(new Event("im-layout-change"));
}

export function syncNotifStripContext(active) {
  applyNotifStripContext(active);
}

export function toggleNotifStrip() {
  const next = !document.documentElement.classList.contains("im-notif-strip-expanded");
  try { localStorage.setItem(NOTIF_STRIP_OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  applyNotifStripContext(true, next);
  return next;
}
