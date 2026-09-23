const HUB_CLASS = "im-chat-hub-open";
let controlsBound = false;
let drawerObserver = null;
let dragging = null;

const WINDOW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5"/></svg>`;
const FULL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/></svg>`;

function nativeDrawer() { return document.querySelector(".chat-drawer"); }
function nativeChatToggle() {
  return document.querySelector('a[title="聊天"], .header-dropdown-toggle.chat button, .chat-header-icon button, a.btn[href="/chat"]');
}

function syncWindowButton(drawer) {
  const button = drawer.querySelector(".c-navbar__full-page-button");
  if (!button) return;
  const windowed = document.documentElement.classList.contains("im-chat-hub-windowed");
  button.dataset.imChatWindowToggle = "1";
  button.title = windowed ? "恢复全屏聊天" : "小窗聊天";
  button.setAttribute("aria-label", button.title);
  const mode = windowed ? "full" : "window";
  if (button.dataset.imChatIcon !== mode) {
    button.dataset.imChatIcon = mode;
    button.innerHTML = windowed ? FULL_ICON : WINDOW_ICON;
  }
}

function setWindowPosition(drawer, x, y) {
  const rect = drawer.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - rect.width - 8);
  const maxY = Math.max(48, window.innerHeight - rect.height - 8);
  drawer.style.setProperty("--im-chat-window-x", `${Math.max(8, Math.min(x, maxX))}px`);
  drawer.style.setProperty("--im-chat-window-y", `${Math.max(48, Math.min(y, maxY))}px`);
}

function toggleChatWindow(drawer) {
  const root = document.documentElement;
  const windowed = !root.classList.contains("im-chat-hub-windowed");
  root.classList.toggle("im-chat-hub-windowed", windowed);
  if (windowed) {
    requestAnimationFrame(() => {
      const rect = drawer.getBoundingClientRect();
      setWindowPosition(drawer, window.innerWidth - rect.width - 24, 64);
    });
  } else {
    drawer.style.removeProperty("--im-chat-window-x");
    drawer.style.removeProperty("--im-chat-window-y");
  }
  syncWindowButton(drawer);
}

function beginDrag(event, drawer) {
  if (!document.documentElement.classList.contains("im-chat-hub-windowed")) return;
  if (event.button !== 0 || event.target.closest("button, a, input, textarea, [role='button']")) return;
  const rect = drawer.getBoundingClientRect();
  dragging = { drawer, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
  drawer.classList.add("is-dragging");
  event.preventDefault();
}
function moveDrag(event) {
  if (dragging) setWindowPosition(dragging.drawer, event.clientX - dragging.dx, event.clientY - dragging.dy);
}
function endDrag() {
  dragging?.drawer.classList.remove("is-dragging");
  dragging = null;
}

function decorateDrawer(drawer) {
  drawer.classList.add("im-dingtalk-chat-hub");
  drawer.setAttribute("aria-label", "NodeLoc 聊天");
  document.documentElement.classList.add(HUB_CLASS);
  syncWindowButton(drawer);
  document.querySelectorAll(".im-rail-item[data-rail-key]").forEach((item) => {
    item.classList.toggle("active", item.dataset.railKey === "messages");
  });
  if (!drawerObserver) {
    drawerObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains(HUB_CLASS)) return;
      const current = nativeDrawer();
      if (current && !current.classList.contains("im-dingtalk-chat-hub")) decorateDrawer(current);
      else if (current) syncWindowButton(current);
    });
    drawerObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (!controlsBound) bindControls();
}

function bindControls() {
  controlsBound = true;
  document.addEventListener("click", (event) => {
    const windowToggle = event.target.closest(".im-dingtalk-chat-hub .c-navbar__full-page-button");
    if (windowToggle) {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
      const current = nativeDrawer();
      if (current) toggleChatWindow(current);
      return;
    }
    const close = event.target.closest(
      ".im-dingtalk-chat-hub .c-navbar__toggle-drawer-button, " +
      '.im-dingtalk-chat-hub button[title*="关闭聊天"], .im-dingtalk-chat-hub button[aria-label*="关闭聊天"]'
    );
    if (close) setTimeout(() => closeDingtalkChatHub({ closeNative: false }), 0);
  }, true);
  document.addEventListener("pointerdown", (event) => {
    const navbar = event.target.closest(".im-dingtalk-chat-hub .c-navbar");
    const current = nativeDrawer();
    if (navbar && current) beginDrag(event, current);
  }, true);
  document.addEventListener("pointermove", moveDrag, true);
  document.addEventListener("pointerup", endDrag, true);
  window.addEventListener("resize", () => {
    const current = nativeDrawer();
    if (!current || !document.documentElement.classList.contains("im-chat-hub-windowed")) return;
    const rect = current.getBoundingClientRect();
    setWindowPosition(current, rect.left, rect.top);
  });
}

function waitForDrawer(attempt = 0) {
  const drawer = nativeDrawer();
  if (drawer) return decorateDrawer(drawer);
  if (attempt < 20) setTimeout(() => waitForDrawer(attempt + 1), 50);
}

export function closeDingtalkChatHub({ closeNative = true } = {}) {
  const drawer = nativeDrawer();
  document.documentElement.classList.remove(HUB_CLASS, "im-chat-hub-windowed");
  endDrag();
  drawerObserver?.disconnect(); drawerObserver = null;
  drawer?.classList.remove("im-dingtalk-chat-hub");
  drawer?.style.removeProperty("--im-chat-window-x");
  drawer?.style.removeProperty("--im-chat-window-y");
  document.querySelector('.im-rail-item[data-rail-key="messages"]')?.classList.remove("active");
  document.querySelector('.im-rail-item[data-rail-key="chat"]')?.classList.add("active");
  document.dispatchEvent(new CustomEvent("im-chat-hub-close"));
  if (!closeNative || !drawer) return;
  drawer.querySelector('.c-navbar__toggle-drawer-button, button[title*="关闭聊天"], button[aria-label*="关闭聊天"]')?.click();
}

export function openDingtalkChatHub() {
  const drawer = nativeDrawer();
  if (drawer) return decorateDrawer(drawer);
  nativeChatToggle()?.click();
  waitForDrawer();
}
