// 原生视图右下角「切回 IM」悬浮按钮
import { ICONS } from "../config/icons.js";
import { getViewMode, setViewMode } from "../state/view-state.js";

export function ensureModeFab() {
  let fab = document.querySelector(".im-mode-fab");
  if (getViewMode() !== "native") {
    fab?.remove();
    return;
  }
  if (!document.body) return;
  if (!fab) {
    fab = document.createElement("button");
    fab.className = "im-mode-fab";
    fab.type = "button";
    fab.title = "切换到美化模式";
    fab.setAttribute("aria-label", "切换到美化模式");
    fab.innerHTML = ICONS.chat;
    fab.addEventListener("click", () => {
      setViewMode("im");
      location.reload();
    });
    document.body.appendChild(fab);
  }
  // 原生页不会保留 IM 根 class，且 Ember 路由可能替换页面样式。关键布局写入
  // inline，保证无论当前节点、管理页或加载阶段，恢复球都可见且可点击。
  Object.assign(fab.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483646",
    width: "46px",
    height: "46px",
    display: "flex",
    visibility: "visible",
    opacity: "1",
    pointerEvents: "auto"
  });
  fab.hidden = false;
}

export function startModeFabWatch() {
  if (window.__imModeFabWatchStarted) return;
  window.__imModeFabWatchStarted = true;
  // 原生 Discourse/Ember 会在软路由、登录状态变化和错误页恢复时重建 body
  // 子树；独立守护不依赖 IM applyTheme，因此悬浮球被移除后也能自动补回。
  const keepAlive = () => {
    if (getViewMode() === "native") ensureModeFab();
    else document.querySelector(".im-mode-fab")?.remove();
  };
  keepAlive();
  window.setInterval(keepAlive, 1000);
  for (const event of ["pageshow", "popstate", "hashchange", "online"]) {
    window.addEventListener(event, keepAlive);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") keepAlive();
  });
}
