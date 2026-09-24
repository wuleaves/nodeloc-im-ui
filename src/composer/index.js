// IMComposer：原生编辑器「原地重锚」嵌入控制器。
// 不搬 Ember DOM，只同步状态类名；几何/皮肤全部由 CSS 变量驱动（styles/core-extra.css.js）。
// 零 chatHooks 耦合：打开链（openNativeComposer 三级兜底）在 ui/composer.js 自持，
// 嵌入态样式纯 CSS 消费 html.im-native-compose / .im-composer[data-native]，无需跨层回调。
import { watchReplyControl } from "./native-bridge.js";
import { isComposerOpen } from "../bridge/discourse.js";

const ROOT_CLASS = "im-native-compose";
const CLOSING_CLASS = "im-native-compose-closing";
let closingSawModal = false;

function applyEmbedState(open) {
  if (open && document.documentElement.classList.contains(CLOSING_CLASS)) return;
  const panel = document.querySelector(".im-chat-panel");
  const active = !!(open && panel);
  document.documentElement.classList.toggle(ROOT_CLASS, active);
  for (const zone of document.querySelectorAll(".im-composer")) {
    if (active) zone.setAttribute("data-native", "1");
    else zone.removeAttribute("data-native");
  }
  syncEmbedGeometry(active);
}

// 几何行内钉死（!important）：行内 important 是作者级最终裁决，压过任何后载主题样式。
// 实测仍有偏移（left:607 视觉在 873）：部分主题给祖先加 transform/filter 等属性，会把
// fixed 的包含块从视口劫持成那个祖先盒子——所以左/下/宽全部「打零读偏移、闭环校准」，
// 不假设包含块是视口；宽用显式 px 而非 left+right 对解（cb 比视口窄时对解会把卡片压窄）。
const EMBED_PROPS = [
  "left", "right", "top", "bottom", "width", "min-width", "height", "min-height", "max-height",
  "transform", "translate", "transition"
];
function syncEmbedGeometry(active) {
  const rc = document.querySelector("#reply-control");
  if (!rc) return;
  // style 盯防：Glimmer 会自行改写 #reply-control 的行内 style（--composer-fields-height 等），
  // 全屏切换触发重渲染时可能把我们钉进去的几何一起抹掉 —— style 一变且几何偏离目标就重钉；
  // 就位时零写入返回，观察者回路到此终止
  if (!rc.dataset.styleWatch) {
    rc.dataset.styleWatch = "1";
    new MutationObserver(() => reSyncEmbedGeometry()).observe(rc, { attributes: true, attributeFilter: ["style"] });
  }
  const clear = () => { for (const p of EMBED_PROPS) rc.style.removeProperty(p); };
  if (!active) {
    clear();
    return;
  }
  const cs = getComputedStyle(document.documentElement);
  const px = (name, fallback) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const narrow = innerWidth <= 1000; // 与皮肤样式 @media 断点一致
  const gap = narrow ? 12 : 16;
  const panels = px("--im-nav", 56) + px("--im-nav2w", 0) + px("--im-strip", 0) + px("--im-list", 300);
  // 全屏 = 铺满右侧聊天区（左缘贴住 IM 面板，不盖 IM 列）；常规 = 留 gap 的底部浮卡。
  // 类名放宽到任意含 full 的段：防主题换全屏类名
  const full = rc.className.split(/\s+/).some((c) => c.toLowerCase().includes("full"));
  const leftT = full ? panels : panels + gap;
  // 就位检测：行内钉还在且矩形命中目标 → 直接返回（观察者回路依赖此零写入终止）
  const r0 = rc.getBoundingClientRect();
  if (
    rc.style.getPropertyValue("left") &&
    Math.abs(r0.left - leftT) <= 2 &&
    Math.abs(r0.right - (innerWidth - (full ? 0 : gap))) <= 2 &&
    (full
      ? Math.abs(r0.top) <= 2 && Math.abs(r0.bottom - innerHeight) <= 2
      : Math.abs(r0.bottom - (innerHeight - 12)) <= 2)
  ) {
    return;
  }
  // 关过渡后同步测量，避免 transition 插值污染读数；嵌入卡片无需滑入动画
  rc.style.setProperty("transition", "none", "important");
  rc.style.setProperty("transform", "none", "important");
  rc.style.setProperty("translate", "none", "important");
  rc.style.setProperty("right", "auto", "important");
  rc.style.setProperty("top", full ? "0px" : "auto", "important");
  // 打零测出包含块原点在视口中的实际位置（顺带吸收祖先 margin），再按目标值反解
  rc.style.setProperty("left", "0px", "important");
  rc.style.setProperty("bottom", "0px", "important");
  const origin = rc.getBoundingClientRect();
  rc.style.setProperty("left", `${leftT - origin.left}px`, "important");
  if (full) {
    rc.style.setProperty("bottom", `${origin.bottom - innerHeight}px`, "important");
    rc.style.setProperty("max-height", "none", "important");
    rc.style.setProperty("width", `${Math.max(320, innerWidth - panels)}px`, "important");
  } else {
    rc.style.setProperty("bottom", `${origin.bottom - (innerHeight - 12)}px`, "important");
    rc.style.setProperty("width", `${Math.max(320, innerWidth - gap - leftT)}px`, "important");
  }
  // 包含块真被劫持时打一次诊断点（指向具体祖先和属性），方便日后定点根治
  if (Math.abs(origin.left) > 1 || Math.abs(origin.bottom - innerHeight) > 2) {
    let n = rc.parentElement;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      const hit = [];
      for (const k of ["transform", "perspective", "filter", "backdrop-filter", "will-change", "contain", "container-type"]) {
        const v = s.getPropertyValue(k);
        if (v && !["none", "normal", "auto"].includes(v)) hit.push(`${k}=${v}`);
      }
      if (s.zoom && parseFloat(s.zoom) !== 1) hit.push(`zoom=${s.zoom}`);
      if (hit.length) {
        console.info("[nodeloc-im] 嵌入编辑器包含块被祖先劫持：", n.className || n.id || n.tagName, hit.join(" "));
        break;
      }
      n = n.parentElement;
    }
  }
  // 首开若撞上 display:none 帧会量出全零：误差大时隔帧重校一次（dataset 防自旋）
  const r = rc.getBoundingClientRect();
  if (Math.abs(r.left - leftT) > 2 || Math.abs(r.right - (innerWidth - (full ? 0 : gap))) > 2) {
    if (!rc.dataset.geoRetry) {
      rc.dataset.geoRetry = "1";
      requestAnimationFrame(() => syncEmbedGeometry(true));
    }
  } else {
    delete rc.dataset.geoRetry;
  }
}
function reSyncEmbedGeometry() {
  if (document.documentElement.classList.contains(ROOT_CLASS)) syncEmbedGeometry(true);
}

/*
 * Discourse 在关闭已填写的新话题时会把“放弃草稿”确认框挂到
 * #main-outlet 下。IM 锁定态会隐藏该区域的原生内容；如果不单独放行弹窗宿主，
 * 透明 backdrop 仍然会拦截点击，视觉上就是“网页卡死”。
 */
function syncNativeModalHosts() {
  for (const old of document.querySelectorAll(".im-native-modal-host")) old.classList.remove("im-native-modal-host");
  const outlet = document.querySelector("#main-outlet");
  if (!outlet) {
    document.documentElement.classList.remove("im-native-modal-open");
    return;
  }
  const modals = document.querySelectorAll(
    ".d-modal, .modal[role='dialog'], dialog[open], [role='dialog'].d-modal__container"
  );
  for (const modal of modals) {
    if (modal.closest(".im-posting-gate, .im-shell")) continue;
    const root = outlet.contains(modal) ? outlet : document.body;
    let host = modal;
    while (host.parentElement && host.parentElement !== root) host = host.parentElement;
    if (host.parentElement === root) host.classList.add("im-native-modal-host");
  }
  const open = !!document.querySelector(".im-native-modal-host");
  if (open && document.documentElement.classList.contains(CLOSING_CLASS)) closingSawModal = true;
  document.documentElement.classList.toggle("im-native-modal-open", open);
  if (!isComposerOpen()) {
    document.documentElement.classList.remove(CLOSING_CLASS);
    closingSawModal = false;
  }
}

/**
 * 原生关闭动作可能同时保存/删除远端草稿。网络慢或断网时，组件状态迟迟不回落，
 * 但关闭界面本身不应等待请求：先本地隐藏并释放 IM 锁，原生事件仍照常在后台执行。
 */
function releaseComposerUiImmediately() {
  const root = document.documentElement;
  if (!isComposerOpen()) return;
  closingSawModal = false;
  root.classList.add(CLOSING_CLASS);
  root.classList.remove(ROOT_CLASS);
  for (const zone of document.querySelectorAll(".im-composer")) zone.removeAttribute("data-native");
  syncEmbedGeometry(false);
  requestAnimationFrame(syncNativeModalHosts);
}

function isComposerCloseControl(target) {
  const control = target.closest?.("button, a, [role='button']");
  if (!control || !control.closest("#reply-control")) return false;
  if (control.matches(
    ".close, .cancel, .discard, .discard-draft, [data-action='close'], [data-action='discard'], " +
    "[aria-label*='关闭'], [aria-label*='舍弃'], [title*='关闭'], [title*='舍弃']"
  )) return true;
  return /^(舍弃|放弃|关闭)$/.test((control.textContent || "").replace(/\s+/g, "").trim());
}

function isModalResumeControl(target) {
  const control = target.closest?.("button, a, [role='button']");
  if (!control?.closest(".im-native-modal-host")) return false;
  const label = `${control.textContent || ""} ${control.getAttribute("aria-label") || ""}`.trim();
  return /取消|继续编辑|返回/.test(label) || control.matches(".d-modal__close, .modal-close, [data-action='close']");
}

function resumeComposerUi() {
  const root = document.documentElement;
  root.classList.remove(CLOSING_CLASS);
  closingSawModal = false;
  if (isComposerOpen()) applyEmbedState(true);
}
window.addEventListener("resize", reSyncEmbedGeometry);
window.addEventListener("im-layout-change", reSyncEmbedGeometry); // 侧栏/列表拖宽时跟随

export function initComposerEmbed() {
  watchReplyControl((open) => {
    if (!open) {
      document.documentElement.classList.remove(CLOSING_CLASS);
      closingSawModal = false;
    }
    applyEmbedState(open);
    syncNativeModalHosts();
    // 关闭动画和确认弹窗可能晚一到数帧挂载。
    if (!open) {
      requestAnimationFrame(syncNativeModalHosts);
      setTimeout(syncNativeModalHosts, 80);
      setTimeout(syncNativeModalHosts, 260);
    }
  });
  new MutationObserver(syncNativeModalHosts).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("click", (event) => {
    if (isComposerCloseControl(event.target)) {
      // 捕获阶段不阻止原生事件，只把美化层的视觉关闭改成本地即时完成。
      requestAnimationFrame(releaseComposerUiImmediately);
      return;
    }
    if (document.documentElement.classList.contains(CLOSING_CLASS) && closingSawModal && isModalResumeControl(event.target)) {
      setTimeout(resumeComposerUi, 0);
    }
  }, true);
  // IM 习惯：嵌入态编辑器内 Enter 直发、⇧Enter 换行（捕获阶段先于 ProseMirror 处理）
  document.addEventListener(
    "keydown",
    (e) => {
      if (!document.documentElement.classList.contains(ROOT_CLASS)) return;
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      if (!e.target.closest?.(".ProseMirror, textarea.d-editor-input")) return;
      const create = document.querySelector("#reply-control .save-or-cancel .create, #reply-control button.create");
      if (create && !create.disabled) {
        e.preventDefault();
        e.stopPropagation();
        create.click();
      }
    },
    true
  );
}

// 模块加载即监听（入口 bootstrap.js 纯 import 触发），早于用户任何交互
initComposerEmbed();
