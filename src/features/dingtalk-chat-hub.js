const HUB_CLASS = "im-chat-hub-open";
let outsideBound = false;
let drawerObserver = null;

function nativeDrawer() {
  return document.querySelector(".chat-drawer");
}

function nativeChatToggle() {
  return document.querySelector(
    'a[title="聊天"], .header-dropdown-toggle.chat button, .chat-header-icon button, a.btn[href="/chat"]'
  );
}

function decorateDrawer(drawer) {
  drawer.classList.add("im-dingtalk-chat-hub");
  drawer.setAttribute("aria-label", "NodeLoc 聊天");
  document.documentElement.classList.add(HUB_CLASS);
  document.querySelectorAll(".im-rail-item[data-rail-key]").forEach((item) => {
    item.classList.toggle("active", item.dataset.railKey === "messages");
  });
  if (!drawerObserver) {
    drawerObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains(HUB_CLASS)) return;
      const current = nativeDrawer();
      if (current && !current.classList.contains("im-dingtalk-chat-hub")) decorateDrawer(current);
    });
    drawerObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (!outsideBound) {
    outsideBound = true;
    document.addEventListener("click", (event) => {
      const close = event.target.closest(
        ".im-dingtalk-chat-hub .c-navbar__toggle-drawer-button, " +
        '.im-dingtalk-chat-hub button[title*="关闭聊天"], ' +
        '.im-dingtalk-chat-hub button[aria-label*="关闭聊天"]'
      );
      if (!close) return;
      setTimeout(() => closeDingtalkChatHub({ closeNative: false }), 0);
    }, true);
  }
}

function waitForDrawer(attempt = 0) {
  const drawer = nativeDrawer();
  if (drawer) {
    decorateDrawer(drawer);
    return;
  }
  if (attempt < 20) setTimeout(() => waitForDrawer(attempt + 1), 50);
}

export function closeDingtalkChatHub({ closeNative = true } = {}) {
  const drawer = nativeDrawer();
  document.documentElement.classList.remove(HUB_CLASS);
  drawerObserver?.disconnect();
  drawerObserver = null;
  drawer?.classList.remove("im-dingtalk-chat-hub");
  document.querySelector('.im-rail-item[data-rail-key="messages"]')?.classList.remove("active");
  document.querySelector('.im-rail-item[data-rail-key="chat"]')?.classList.add("active");
  if (!closeNative || !drawer) return;
  const close = drawer.querySelector(
    '.c-navbar__toggle-drawer-button, button[title*="关闭聊天"], button[aria-label*="关闭聊天"]'
  );
  close?.click();
}

export function openDingtalkChatHub() {
  const drawer = nativeDrawer();
  if (drawer) {
    decorateDrawer(drawer);
    return;
  }
  nativeChatToggle()?.click();
  waitForDrawer();
}
