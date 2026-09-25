import { FAVICON_ID } from "../config/constants.js";
import { FAVICON_URI } from "../config/skins.js";

let faviconObserver = null;
let faviconApplying = false;

function faviconMimeType(href) {
  const dataType = String(href || "").match(/^data:(image\/[a-z0-9.+-]+)/i)?.[1];
  if (dataType) return dataType;
  if (/\.svg(?:[?#]|$)/i.test(href)) return "image/svg+xml";
  if (/\.png(?:[?#]|$)/i.test(href)) return "image/png";
  return "image/x-icon";
}

export function makeFavicon() {
  const head = document.head;
  if (!head || faviconApplying) return;
  faviconApplying = true;
  try {
    const href = FAVICON_URI;
    const mimeType = faviconMimeType(href);
    // 覆盖所有常见 icon 链（含 shortcut / apple-touch），避免未选中标签仍用站点原图
    const icons = head.querySelectorAll(
      "link[rel='icon'], link[rel='shortcut icon'], link[rel~='icon'], link[rel='apple-touch-icon'], link[rel='apple-touch-icon-precomposed'], link[rel='mask-icon']"
    );
    for (const icon of icons) {
      if (icon.id && icon.id !== FAVICON_ID) icon.removeAttribute("id");
      if (icon.getAttribute("href") !== href) icon.setAttribute("href", href);
      if (icon.rel === "mask-icon") continue;
      if (icon.getAttribute("type") !== mimeType) icon.setAttribute("type", mimeType);
      if (!icon.getAttribute("sizes")) icon.setAttribute("sizes", "any");
    }

    let link = document.getElementById(FAVICON_ID);
    if (!link) {
      link = document.createElement("link");
      link.id = FAVICON_ID;
      link.rel = "icon";
      link.type = mimeType;
      link.sizes = "any";
      link.setAttribute("href", href);
      head.appendChild(link);
    } else if (link.getAttribute("href") !== href) {
      link.setAttribute("href", href);
      link.setAttribute("type", mimeType);
    } else if (link.getAttribute("type") !== mimeType) {
      link.setAttribute("type", mimeType);
    }

    // 再补一条 shortcut icon，部分浏览器未聚焦标签时优先读它
    let shortcut = head.querySelector("link[data-im-shortcut='1']");
    if (!shortcut) {
      shortcut = document.createElement("link");
      shortcut.rel = "shortcut icon";
      shortcut.type = mimeType;
      shortcut.dataset.imShortcut = "1";
      shortcut.setAttribute("href", href);
      head.insertBefore(shortcut, head.firstChild);
    } else if (shortcut.getAttribute("href") !== href) {
      shortcut.setAttribute("href", href);
      shortcut.setAttribute("type", mimeType);
    } else if (shortcut.getAttribute("type") !== mimeType) {
      shortcut.setAttribute("type", mimeType);
    }

    if (!faviconObserver) {
      faviconObserver = new MutationObserver(() => {
        if (faviconApplying) return;
        // 站点 SPA / 主题脚本可能写回原 favicon
        makeFavicon();
      });
      faviconObserver.observe(head, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel", "type", "sizes"]
      });
    }
  } finally {
    faviconApplying = false;
  }
}
