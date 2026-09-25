// IM 独立输入框：绑定、上传、发送（API 直发 + 原生编辑器兜底）、定向回复
import { composerState } from "../state/composer-state.js";
import { chatState, topicPostsMap } from "../state/chat-state.js";
import { csrfToken } from "../bridge/api.js";
import {
  discourseRequire, getComposerService, getEmberOwner, getTopicModel,
  findLoadedPost, isComposerOpen, refreshNativeTopicState, safeLookup,
} from "../bridge/discourse.js";
import { getCurrentUsername, normalizeUsername } from "../bridge/user.js";
import { LOCK_CLASS, COMPOSE_PREVIEW_KEY } from "../config/constants.js";
import { fetchLatestNewPosts, rebindLotteryCards, syncNewPostsFromDom } from "./chat-panel.js";
import { chatHooks } from "./hooks.js";
import { mdToHtml, registerUploadUrl } from "./markdown-lite.js";



/* ---------- 快捷输入框：contenteditable 块级实时渲染 Markdown ----------
   模型：.im-md-edit 容器内若干 .im-md-block；聚焦块保持 markdown 原文可编辑，
   其余块实时渲染（Typora 式渐进）；data-src 始终保存原文，发送时按块拼接。 */
function mdBlocks(input) {
  return [...input.querySelectorAll(".im-md-block")];
}
function mdEnsureBlock(input) {
  if (!input.querySelector(".im-md-block")) {
    const block = document.createElement("div");
    block.className = "im-md-block";
    input.appendChild(block);
  }
}
function mdIsEmpty(input) {
  return !mdGetSource(input);
}
function mdGetSource(input) {
  return mdBlocks(input)
    .map((b) => (b.dataset.src ?? b.innerText).trim())
    .filter(Boolean)
    .join("\n\n");
}
function mdSyncActive(input) {
  const sel = getSelection();
  const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const block = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".im-md-block");
  if (block?.parentNode === input) block.dataset.src = block.innerText;
  input.classList.toggle("has-content", !mdIsEmpty(input));
  syncPreview(input);
}
/* ---------- 预览条：开关式实时渲染（整段原文按块渲染，复用 .im-md-block 样式） ---------- */
function isPreviewOn() {
  try { return localStorage.getItem(COMPOSE_PREVIEW_KEY) === "1"; } catch { return false; }
}
function syncPreview(input) {
  const preview = input?.closest(".im-composer-card")?.querySelector(".im-compose-preview");
  if (!preview || !preview.classList.contains("active")) return;
  const src = mdGetSource(input);
  preview.innerHTML = src
    ? src.split(/\n{2,}/).map((part) => `<div class="im-md-block is-rendered">${mdToHtml(part)}</div>`).join("")
    : "";
  preview.classList.toggle("is-empty", !src);
}
function togglePreview(btn, panel) {
  const preview = panel.querySelector(".im-compose-preview");
  const input = panel.querySelector(".im-chat-compose");
  if (!preview || !input) return;
  const on = !preview.classList.contains("active");
  preview.classList.toggle("active", on);
  btn.classList.toggle("active", on);
  try { localStorage.setItem(COMPOSE_PREVIEW_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  if (on) syncPreview(input);
}
function mdRenderBlock(block) {
  const src = (block.dataset.src ?? "").trim();
  block.classList.add("is-rendered");
  block.innerHTML = src ? mdToHtml(src) : "";
}
function mdEditBlock(block) {
  block.textContent = block.dataset.src ?? block.innerText;
  block.classList.remove("is-rendered");
}
function mdRenderAll(input) {
  const src = mdGetSource(input);
  const parts = src ? src.split(/\n{2,}/) : [""];
  input.innerHTML = "";
  for (const part of parts) {
    const block = document.createElement("div");
    block.className = "im-md-block";
    block.dataset.src = part;
    input.appendChild(block);
    mdRenderBlock(block);
  }
  input.classList.toggle("has-content", !!src);
}
function mdClear(input) {
  input.innerHTML = "";
  mdEnsureBlock(input);
  input.classList.remove("has-content");
  syncPreview(input);
}
function placeCaretEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
function activeBlock() {
  const sel = getSelection();
  const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  return el?.closest?.(".im-md-block") ?? null;
}
/** 多行文本按行插入：insertText + insertLineBreak（保留浏览器撤销栈） */
function insertAtCaret(text) {
  const lines = String(text).split("\n");
  document.execCommand("insertText", false, lines[0]);
  for (let i = 1; i < lines.length; i++) {
    document.execCommand("insertLineBreak");
    document.execCommand("insertText", false, lines[i]);
  }
}

function wireComposer(panel) {
  const input = panel.querySelector(".im-chat-compose");
  if (!input || input.dataset.wired === "1") return;
  input.dataset.wired = "1";
  mdEnsureBlock(input);
  wireQuickComposer(panel, input);
}

function wireQuickComposer(panel, input) {
  const send = panel.querySelector(".im-send-btn");
  const target = panel.querySelector(".im-composer-target");
  const targetClose = target?.querySelector("button");
  const fileInput = panel.querySelector(".im-composer-file");
  const imageBtn = panel.querySelector('.im-composer-tools .im-icon-btn[data-tool="folder"]');

  function updateSendState() {
    send.disabled = composerState.submitting || composerState.uploading || mdIsEmpty(input);
  }
  updateSendState();
  input.addEventListener("input", () => {
    mdSyncActive(input);
    updateSendState();
  });
  // 点击已渲染的块 → 还原原文编辑，光标尽量落在点击处
  input.addEventListener("mousedown", (e) => {
    const block = e.target.closest?.(".im-md-block");
    if (!block?.classList.contains("is-rendered")) return;
    if (document.activeElement === input) {
      // 编辑器已持焦：点击渲染块不会触发 focusin，就地还原
      e.preventDefault();
      mdEditBlock(block);
      const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      const sel = getSelection();
      if (r && block.contains(r.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(r);
      } else {
        placeCaretEnd(block);
      }
    } else {
      input._caretAt = { x: e.clientX, y: e.clientY }; // 焦点即将进入，focusin 统一处理
    }
  });
  input.addEventListener("focusin", () => {
    // contenteditable 宿主是唯一可聚焦元素，focusin 目标恒为宿主：按点击点还原对应块
    const at = input._caretAt;
    input._caretAt = null;
    let hit = at && document.caretRangeFromPoint?.(at.x, at.y);
    let block = hit && (hit.startContainer.nodeType === 1 ? hit.startContainer : hit.startContainer.parentElement)?.closest?.(".im-md-block");
    if (block) {
      if (block.classList.contains("is-rendered")) mdEditBlock(block);
      hit = document.caretRangeFromPoint?.(at.x, at.y); // 原文态下重新定位光标
      const sel = getSelection();
      if (hit && block.contains(hit.startContainer)) {
        sel.removeAllRanges();
        sel.addRange(hit);
      } else {
        placeCaretEnd(block);
      }
      return;
    }
    block = activeBlock() ?? input.querySelector(".im-md-block"); // Tab 聚焦 / 程序 focus
    if (!block) return;
    if (block.classList.contains("is-rendered")) {
      mdEditBlock(block);
      placeCaretEnd(block);
    }
  });
  input.addEventListener("focusout", () => {
    // 宿主失焦：活动块原文已由 mdSyncActive 记录，整段按空行重排渲染
    mdSyncActive(input);
    mdRenderAll(input);
  });
  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && !e.isComposing) {
      const act = { b: "bold", i: "italic", e: "code", k: "link" }[e.key.toLowerCase()];
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        applyMarkdownFormat(input, act);
        return;
      }
    }
    // ⇧⌘ 组合对齐原生：D 详情 / M 公式 / . 日期
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && !e.isComposing) {
      const act = { d: "details", m: "math", ".": "date" }[e.key.toLowerCase()];
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        PLUS_ACTIONS[act](input);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      e.stopPropagation();
      if (!mdIsEmpty(input)) submitComposer();
      return;
    }
    if (e.key === "Enter" && e.shiftKey && !e.isComposing) {
      e.preventDefault(); // 块内换行：<br>，源里是 \n
      document.execCommand("insertLineBreak");
      return;
    }
    if (e.key === "Backspace" && mdBlocks(input).length === 1 && !input.innerText.trim()) {
      e.preventDefault(); // 保底：唯一空块不允许删掉
    }
  });

  send.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    submitComposer();
  });

  if (imageBtn) {
    imageBtn.title = "上传图片";
    imageBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });
  }
  fileInput.addEventListener("change", (e) => {
    uploadComposerFiles(e.target.files);
    e.target.value = "";
  });

  // Markdown 工具条：mousedown 阻止失焦以保留编辑器选区，click 就地格式化
  for (const btn of panel.querySelectorAll(".im-composer-tools .im-icon-btn[data-tool]")) {
    const kind = btn.dataset.tool;
    if (kind === "folder") continue; // 已有上传绑定
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (kind === "emoji") toggleEmojiPicker(btn, input);
      else if (kind === "plus") togglePlusPop(btn, input);
      else if (kind === "preview") togglePreview(btn, panel);
      else applyMarkdownFormat(input, kind);
    });
  }

  input.addEventListener("paste", (e) => handleComposerPaste(e));
  panel.querySelector(".im-composer-card")?.addEventListener("drop", (e) => handleComposerDrop(e));
  panel.querySelector(".im-composer-card")?.addEventListener("dragover", (e) => { e.preventDefault(); });

  // 预览条开关状态持久化恢复
  const previewEl = panel.querySelector(".im-compose-preview");
  if (previewEl && isPreviewOn()) {
    previewEl.classList.add("active");
    panel.querySelector('.im-composer-tools .im-icon-btn[data-tool="preview"]')?.classList.add("active");
    syncPreview(input);
  }

  targetClose?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    hideTargetedReply();
    input.focus();
  });
}
function flashComposeHint(message, kind) {
  setComposeStatus(message, kind); // 输入框已是 contenteditable，提示统一走工具行状态位
}





function setComposeStatus(message, kind) {
  const status = document.querySelector(".im-composer-status");
  if (!status) return;
  status.textContent = message || "";
  status.title = message || "";
  status.classList.remove("busy", "error", "success");
  if (kind) status.classList.add(kind);
  if (message) {
    clearTimeout(setComposeStatus._timer);
    setComposeStatus._timer = setTimeout(() => {
      status.textContent = "";
      status.title = "";
      status.classList.remove("busy", "error", "success");
    }, 3200);
  }
}
function composeUi() {
  const card = document.querySelector(".im-composer-card");
  return {
    card,
    input: card?.querySelector(".im-chat-compose"),
    target: card?.querySelector(".im-composer-target"),
    send: card?.querySelector(".im-send-btn"),
    status: card?.querySelector(".im-composer-status")
  };
}
function updateComposeSendState() {
  const { input, send } = composeUi();
  if (!input || !send) return;
  send.disabled = composerState.submitting || composerState.uploading || mdIsEmpty(input);
}
/* ---------- 快捷输入框 Markdown 工具条（按钮语义参考 Discourse composer toolbar.ts；contenteditable 选区版） ---------- */

/** 拿到可编辑的原文活动块：无焦点时聚焦编辑器落到块上；渲染态先还原原文 */
function ensureActiveBlock(input) {
  let block = activeBlock(input);
  if (!block) {
    input.focus({ preventScroll: true });
    block = activeBlock(input);
    if (!block) {
      block = mdBlocks(input).at(-1);
      if (block) placeCaretEnd(block);
    }
  }
  if (block?.classList.contains("is-rendered")) {
    mdEditBlock(block);
    placeCaretEnd(block);
  }
  return block ?? null;
}
function currentSelText() {
  const sel = getSelection();
  return sel.rangeCount ? sel.getRangeAt(0).toString() : "";
}
/** 光标处回退选中：尾部跳过 skipTail 字符再往前取 len 字符（用于选中占位文字/URL） */
function selectBack(skipTail, len) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  let node = r.startContainer;
  if (node.nodeType !== 3) node = node.lastChild;
  if (!node || node.nodeType !== 3) return;
  const end = node.length - skipTail;
  if (len <= 0 || end < 0 || end - len < 0) return;
  const range = document.createRange();
  range.setStart(node, end - len);
  range.setEnd(node, end);
  sel.removeAllRanges();
  sel.addRange(range);
}
/** 焦点内插文 + 同步源码与发送态 */
function insertComposeText(input, text) {
  input.focus({ preventScroll: true });
  // 焦点/选区不在编辑器内时（弹层点击、外部失焦后）execCommand 会静默落空 → 光标先落到末块
  const sel = getSelection();
  if (!sel.rangeCount || !input.contains(sel.getRangeAt(0).startContainer)) {
    placeCaretEnd(input);
  }
  insertAtCaret(text);
  mdSyncActive(input);
  updateComposeSendState();
}
/** 包裹型：**加粗** / *斜体* / ~~删除~~；已包裹则剥掉；空选区插入占位并选中 */
function applyWrap(mark, placeholder) {
  const text = currentSelText();
  if (text.length >= mark.length * 2 && text.startsWith(mark) && text.endsWith(mark)) {
    insertAtCaret(text.slice(mark.length, text.length - mark.length));
    return;
  }
  insertAtCaret(mark + (text || placeholder) + mark);
  if (!text) selectBack(mark.length, placeholder.length);
}
/** 行前缀型：> 引用 / - 无序 / 1. 有序；整块已带前缀则剥掉（toggle） */
function applyLinePrefix(input, kind) {
  transformActiveBlock(input, (src) => {
    const lines = src.split("\n");
    const markOf = (i) => (kind === "quote" ? "> " : kind === "ul" ? "- " : `${i + 1}. `);
    const allMarked = lines.every((line, i) => !line.trim() || line.startsWith(markOf(i)));
    return lines
      .map((line, i) => {
        const mark = markOf(i);
        if (allMarked) return line.startsWith(mark) ? line.slice(mark.length) : line;
        return mark + line; // 引用含空行也加前缀（applyEmptyLines，保持引用块连续）
      })
      .join("\n");
  });
}
/** 整块源码变换：切到原文态 → 替换 data-src → 光标落块尾 */
function transformActiveBlock(input, fn) {
  const block = ensureActiveBlock(input);
  if (!block) return;
  block.dataset.src = fn(block.dataset.src ?? block.innerText);
  block.textContent = block.dataset.src;
  placeCaretEnd(block);
  mdSyncActive(input);
}
/** 代码：多行选区 → ``` 围栏；否则行内反引号（对应原生 formatCode 语义） */
function applyCodeFormat(selText) {
  if (selText.includes("\n")) insertAtCaret("\n```\n" + selText.replace(/\n+$/, "") + "\n```\n");
  else applyWrap("`", "代码");
}
/** 链接：插入 [文字](https://) 并选中待改部分 */
function applyLinkFormat() {
  const text = currentSelText();
  insertAtCaret(`[${text || "链接文字"}](https://)`);
  if (text) selectBack(1, 8); // 选中 https://
  else selectBack(10, "链接文字".length); // 选中「链接文字」
}
/** 文本大小：标题级别循环 none→H2→H3→H4→none（整块升降级） */
function applyHeadingFormat(input) {
  transformActiveBlock(input, (src) => {
    const lines = src.split("\n");
    const levelOf = (line) => (line.match(/^#{1,4} /)?.[0].length ?? 0) - 1;
    const levels = lines.map(levelOf);
    const cur = levels[0];
    const next = levels.every((lv) => lv === cur) && cur > 0 ? (cur === 4 ? 0 : cur + 1) : 2;
    return lines
      .map((line, i) => {
        const stripped = line.replace(/^#{1,4} /, "");
        return next === 0 ? stripped : `${"#".repeat(next)} ${levels[i] > 0 ? stripped : line}`;
      })
      .join("\n");
  });
}
function applyMarkdownFormat(input, kind) {
  if (!input) return;
  ensureActiveBlock(input);
  const text = currentSelText();
  switch (kind) {
    case "bold": return applyWrap("**", "加粗文字");
    case "italic": return applyWrap("*", "斜体文字");
    case "strike": return applyWrap("~~", "删除文字");
    case "heading": return applyHeadingFormat(input);
    case "code": return applyCodeFormat(text);
    case "link": return applyLinkFormat();
    case "quote": return applyLinePrefix(input, "quote");
    case "listUl": return applyLinePrefix(input, "ul");
    case "listOl": return applyLinePrefix(input, "ol");
  }
}

/* ---------- 输入框弹层：原生表情选择器 + 更多菜单（模板/表格/wrap） ---------- */
const QUICK_EMOJI = [
  "😀", "😅", "😂", "🤣", "😊", "😍", "😘", "😜",
  "🤔", "😎", "🥳", "😴", "🙄", "😮", "😢", "😡",
  "🤝", "👍", "👎", "👏", "🙏", "💪", "🚀", "🔥",
  "✅", "❌", "⚡", "🎉", "❤️", "💔", "🤡", "🙈",
  "💯", "🤖", "👀", "🫡"
];
let popEl = null;
let popOutsideClose = null;
function closePop() {
  if (!popEl) return;
  popEl.remove();
  popEl = null;
  if (popOutsideClose) {
    document.removeEventListener("mousedown", popOutsideClose);
    popOutsideClose = null;
  }
}
function openPop(btn, className, html) {
  closePop();
  popEl = document.createElement("div");
  popEl.className = className;
  popEl.innerHTML = html;
  document.body.appendChild(popEl);
  const rect = btn.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popEl.offsetWidth - 8));
  const top = Math.max(8, rect.top - popEl.offsetHeight - 8);
  popEl.style.left = left + "px";
  popEl.style.top = top + "px";
  // mousedown preventDefault：不抢 textarea 焦点，选区/光标原样保留
  popEl.addEventListener("mousedown", (e) => e.preventDefault());
  popOutsideClose = (e) => {
    if (!popEl?.contains(e.target)) closePop();
  };
  document.addEventListener("mousedown", popOutsideClose);
}
/** 原生表情选择器：与原生工具栏表情按钮同一条链（menu service + EmojiPickerDetached），插入 :shortcode: */
function openNativeEmojiPicker(btn, onPick) {
  const owner = getEmberOwner();
  const menu = owner && safeLookup(owner, "service:menu");
  const detached = discourseRequire("discourse/components/emoji-picker/detached")?.default;
  if (!menu || !detached) return false;
  try {
    menu.show(btn, {
      identifier: "emoji-picker",
      groupIdentifier: "emoji-picker",
      component: detached,
      modalForMobile: true,
      data: { didSelectEmoji: (emoji) => onPick(emoji) }
    });
    return true;
  } catch {
    return false;
  }
}
function toggleEmojiPicker(btn, input) {
  if (openNativeEmojiPicker(btn, (emoji) => insertComposeText(input, `:${emoji}:`))) return;
  if (popEl?.classList.contains("im-emoji-pop")) return closePop();
  openPop(btn, "im-emoji-pop", QUICK_EMOJI.map(
    (e) => `<button type="button" class="im-emoji-item">${e}</button>`
  ).join(""));
  popEl.addEventListener("click", (e) => {
    const item = e.target.closest(".im-emoji-item");
    if (!item) return;
    insertComposeText(input, item.textContent);
    closePop();
  });
}
/* 更多菜单动作（对应原生 + 号选项菜单全量 14 项）。
   语法出处：details/math/graphviz/poll 取自 Discourse 核心插件源码；
   scroll/blur/chart/mermaid 为站点定制 BBCode，按社区惯例实现，渲染异常再修正。 */
function surroundWith(input, before, after, placeholder) {
  const text = currentSelText();
  insertComposeText(input, before + (text || placeholder) + after);
}
function insertBlock(input, text) {
  insertComposeText(input, text);
}
function localDateMarkup() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  return `[date=${date} time=${time} timezone="${tz}"] `;
}
function insertQuoteOfTarget(input) {
  const posts = topicPostsMap.get(Number(chatState.topicId)) || [];
  const post = posts.find((p) => p.post_number === Number(composerState.replyToPostNumber)) || posts[0];
  if (!post?.id) return flashComposeHint("未找到可引用的楼层");
  fetch(`/posts/${post.id}.json`, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => insertBlock(input, `[quote="${data.username}, post:${data.post_number}"]\n${data.raw}\n[/quote]`))
    .catch(() => flashComposeHint("引用加载失败"));
}
function insertFootnote(input) {
  const n = (mdGetSource(input).match(/\[\^\d+\]:/g) || []).length + 1;
  insertComposeText(input, `[^${n}]`); // 引用标记落在光标处
  const def = `[^${n}]: 脚注内容`;
  const block = document.createElement("div");
  block.className = "im-md-block";
  block.dataset.src = def;
  block.textContent = def;
  input.appendChild(block); // 定义追加为末块
  input.classList.add("has-content");
  syncPreview(input);
  const range = document.createRange(); // 选中占位文字便于改写
  range.setStart(block.firstChild, 6);
  range.setEnd(block.firstChild, 10);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
/* 模板桥：offscreen textarea，接住官方 d-templates 插件的 execCommand 写入 */
let tplBridge = null;
const PLUS_ACTIONS = {
  quote: (input) => insertQuoteOfTarget(input),
  table: (input) => insertBlock(input, "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n"),
  scroll: (input) => surroundWith(input, "[wrap=scroll]\n", "\n[/wrap]", "内容"),
  mermaid: (input) => insertBlock(input, "```mermaid\nflowchart TD\n  A --> B\n```\n"),
  chart: (input) => insertBlock(input, '```chart\n{"title":"图表标题","type":"bar","data":{"labels":["一","二"],"series":[[1,2]]}}\n```\n'),
  details: (input) => surroundWith(input, '[details="标题"]\n', "\n[/details]\n", "内容"),
  graphviz: (input) => insertBlock(input, "[graphviz]\ndigraph G {\n  A -> B;\n}\n[/graphviz]\n"),
  date: (input) => insertBlock(input, localDateMarkup()),
  math: (input) => insertBlock(input, "$$\n公式\n$$\n"),
  template: () => {
    const owner = getEmberOwner();
    const dTemplates = owner && safeLookup(owner, "service:d-templates");
    if (!dTemplates) return flashComposeHint("当前账号无模板权限");
    // showTextAreaUI 只吃 textarea，且插件写入路径为 focus + execCommand：
    // 桥必须真实挂载到 DOM（游离节点 focus/execCommand 全部无效），离屏即可
    if (!tplBridge || !tplBridge.isConnected) {
      tplBridge = document.createElement("textarea");
      tplBridge.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;";
      tplBridge.addEventListener("input", () => {
        const live = document.querySelector(".im-chat-compose"); // 事件时现查，防面板重建引用失效
        if (!tplBridge.value || !live) return;
        insertBlock(live, tplBridge.value);
        tplBridge.value = "";
        // 插件 afterRender 会把焦点拉回隐藏桥，这里归还给输入框
        setTimeout(() => live.focus({ preventScroll: true }), 80);
      });
      document.body.appendChild(tplBridge);
    }
    dTemplates.showTextAreaUI(null, tplBridge);
  },
  footnote: (input) => insertFootnote(input),
  blur: (input) => surroundWith(input, "[blur]", "[/blur]", "内容"),
  poll: (input) => insertBlock(input, "[poll]\n- 选项一\n- 选项二\n[/poll]\n"),
  wrap: (input) => surroundWith(input, "[wrap]\n", "\n[/wrap]", "内容")
};
const PLUS_ITEMS = [
  { id: "quote", ico: "💬", label: "引用整个帖子" },
  { id: "table", ico: "▦", label: "插入表" },
  { id: "scroll", ico: "📜", label: "插入滚动内容" },
  { id: "mermaid", ico: "🧩", label: "Mermaid 图表" },
  { id: "chart", ico: "📈", label: "Build Chart" },
  { id: "details", ico: "▸", label: "隐藏详细信息（⇧⌘D）" },
  { id: "graphviz", ico: "🕸", label: "插入 Graphviz" },
  { id: "date", ico: "🕐", label: "插入日期/时间（⇧⌘.）" },
  { id: "math", ico: "√", label: "插入公式（⇧⌘M）" },
  { id: "template", ico: "📋", label: "插入模板" },
  { id: "footnote", ico: "＊", label: "添加脚注" },
  { id: "blur", ico: "🫧", label: "模糊剧透" },
  { id: "poll", ico: "🗳", label: "构建投票" },
  { id: "wrap", ico: "❏", label: "应用换行" }
];
function togglePlusPop(btn, input) {
  if (popEl?.classList.contains("im-plus-pop")) return closePop();
  openPop(btn, "im-plus-pop", PLUS_ITEMS.map(
    (it) => `<button type="button" class="im-plus-item" data-act="${it.id}"><span class="ico">${it.ico}</span>${it.label}</button>`
  ).join(""));
  popEl.addEventListener("click", (e) => {
    const item = e.target.closest(".im-plus-item");
    if (!item) return;
    const act = item.dataset.act;
    closePop();
    input.focus();
    PLUS_ACTIONS[act]?.(input);
  });
}
async function submitReplyViaApi(raw, replyToPostNumber) {
  // 与 Discourse 原生 composer 保持一致，使用表单编码；部分 NodeLoc 插件中间件
  // 只从 form body 读取发帖字段，JSON 虽能到达 /posts.json，却会返回通用失败。
  const body = new URLSearchParams();
  body.set("raw", raw);
  body.set("topic_id", String(Number(chatState.topicId)));
  if (replyToPostNumber) body.set("reply_to_post_number", String(Number(replyToPostNumber)));
  const response = await fetch("/posts.json", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "X-CSRF-Token": csrfToken(),
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  // 站点校验拒绝：HTTP 200 + {action:"create_post", errors:[...]}（如「正文 过短（最少 16 个字符）」）。
  // 标记 validation：这类错误填进原生编辑器也会被同样拒绝，不应兜底打开原生编辑器
  const rawErrors = payload.errors?.length ? payload.errors : (payload.error || payload.message ? [payload.error || payload.message] : null);
  const serverErrors = rawErrors
    ? (Array.isArray(rawErrors) ? rawErrors : [rawErrors]).map((item) =>
      typeof item === "string" ? item : (item?.message || item?.error || JSON.stringify(item))
    ).filter(Boolean)
    : null;
  if (serverErrors) {
    const err = new Error(serverErrors.join("；"));
    err.serverPayload = payload;
    err.serverErrors = serverErrors;
    // 仅明确的内容规则错误不值得再开原生编辑器；通用错误可能来自插件中间件，
    // 应继续走原生 composer 兜底。
    err.validation = serverErrors.some((message) =>
      /过短|太短|至少.{0,8}(?:字|字符)|不能为空|字数|字符数|超过.{0,8}(?:字|字符)|too short|too long|required/i.test(message)
    );
    throw err;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const post = payload.post || payload.created_post || payload;
  // NodeLoc 的插件链可能只返回 success / post_number，不一定返回标准 post.id。
  // HTTP 成功且没有 errors 即代表 Discourse 已接受，后续由话题同步确认新楼层。
  return post || null;
}

/* ---------- 节点发言门禁 ----------
   NodeLoc 的节点可以要求成员资格、审批、信任等级或限制回复。
   IM 界面不再把这些信息压成“发送失败”，而是显示可操作的门禁提示。 */
function textOf(element) {
  return element?.textContent?.replace(/\s+/g, " ").trim() || "";
}
function nodeSlugFromHref(href) {
  return String(href || "").match(/^\/n\/([^/?#]+)/)?.[1] || "";
}
function nativeNodeJoinButton(slug) {
  const gateButton = [...document.querySelectorAll(".community-posting-gate button")]
    .find((button) => /加入(?:节点)?/.test(textOf(button)));
  if (gateButton) return gateButton;
  if (!slug) return null;
  const nodePath = `/n/${decodeURIComponent(slug)}`;
  const links = [...document.querySelectorAll('a[href^="/n/"]')].filter((link) => {
    try { return decodeURIComponent(new URL(link.href, location.origin).pathname) === nodePath; }
    catch { return false; }
  });
  for (const link of links) {
    let scope = link.parentElement;
    for (let depth = 0; scope && depth < 8; depth++, scope = scope.parentElement) {
      const button = scope.querySelector?.("button.community-join-button");
      if (button && !button.closest(".im-shell, .im-posting-gate")) return button;
    }
  }
  return null;
}
function currentNodeInfo() {
  // IM 话题头部的节点 chip 来自当前 topic JSON，不能拿页面中“任意一个”节点卡片，
  // 否则加入了 AI 时也可能误拾取另一个节点的加入按钮而拦截每次发送。
  const link = document.querySelector('.im-chat-chip[href^="/n/"]')
    || document.querySelector('.community-topic-view-compact a[href^="/n/"]');
  const href = link?.getAttribute("href") || "";
  const slug = nodeSlugFromHref(href);
  const joinButton = nativeNodeJoinButton(slug);
  const scope = joinButton?.parentElement?.parentElement || link?.parentElement || document;
  const label = textOf(link).replace(/^n\//i, "") || slug || "当前节点";
  const scopeText = textOf(scope);
  const memberClass = slug ? `group-${decodeURIComponent(slug).replace(/[^a-z0-9_-]/gi, "-")}-members` : "";
  return {
    joinButton,
    slug,
    label,
    isMember: !!memberClass && document.body.classList.contains(memberClass),
    isPublic: /(?:^|\s)公开(?:\s|$)/.test(scopeText) || document.body.classList.contains("community-node-page")
  };
}
function classifyPostingRestriction(message) {
  const exact = String(message || "").trim() || "站点未返回具体原因。";
  const rules = [
    { test: /只允许成员|还不是成员|加入.*(?:节点|社区)|member/i, title: "需要加入节点", hint: "这个节点只允许成员发帖和回复。" },
    { test: /私有|邀请|invite|private/i, title: "节点需要邀请", hint: "该节点不能直接加入，请联系节点管理员。" },
    { test: /审批|申请|approval|pending/i, title: "节点需要审批", hint: "提交加入申请并等待管理员通过后即可回复。" },
    { test: /已关闭|关闭了|不允许回复|closed/i, title: "话题已关闭", hint: "该话题目前不接受新回复。" },
    { test: /归档|archived/i, title: "话题已归档", hint: "归档话题无法继续回复。" },
    { test: /只读|禁止发言|read.?only/i, title: "当前为只读状态", hint: "该节点或话题暂时禁止发言。" },
    { test: /信任等级|用户等级|级别不足|没有权限|trust level|permission/i, title: "发言权限不足", hint: "当前账号尚未达到该节点的发言要求。" },
    { test: /慢速模式|稍后再试|过于频繁|slow.?mode|rate.?limit/i, title: "需要等待后再回复", hint: "请按提示等待后重试，草稿会为你保留。" },
    { test: /过短|太短|至少.{0,8}(?:字|字符)|不能为空|required|too short/i, title: "回复内容未达要求", hint: "请按站点提示补充内容后重试。" },
    { test: /过长|超过.{0,8}(?:字|字符)|too long/i, title: "回复内容过长", hint: "请精简内容或拆分后再发送。" },
    { test: /登录|not logged|authentication/i, title: "需要登录", hint: "请先登录 NodeLoc 后再回复。" }
  ];
  const match = rules.find((rule) => rule.test.test(exact));
  return match ? { ...match, message: exact } : {
    title: "暂时无法回复",
    message: exact,
    hint: "这是 NodeLoc 返回的完整提示；修正后可直接重试，草稿不会丢失。"
  };
}
function closePostingGate() {
  document.querySelector(".im-posting-gate")?.remove();
}
function showPostingGate(message, options = {}) {
  closePostingGate();
  const info = classifyPostingRestriction(message);
  const joinButton = options.joinButton || null;
  const overlay = document.createElement("div");
  overlay.className = "im-posting-gate";
  overlay.innerHTML = `<section class="im-posting-gate-card" role="dialog" aria-modal="true" aria-labelledby="im-posting-gate-title">
    <header><h2 id="im-posting-gate-title"></h2><button type="button" class="im-posting-gate-close" aria-label="关闭">×</button></header>
    <div class="im-posting-gate-body"><p class="im-posting-gate-message"></p><p class="im-posting-gate-hint"></p></div>
    <footer></footer>
  </section>`;
  overlay.querySelector("h2").textContent = options.title || info.title;
  overlay.querySelector(".im-posting-gate-message").textContent = info.message;
  overlay.querySelector(".im-posting-gate-hint").textContent = options.hint || info.hint;
  const footer = overlay.querySelector("footer");
  if (joinButton) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "im-posting-gate-primary";
    action.textContent = options.actionLabel || "加入节点";
    action.addEventListener("click", async () => {
      action.disabled = true;
      action.textContent = "正在加入…";
      const hint = overlay.querySelector(".im-posting-gate-hint");
      joinButton.click();
      let joined = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const current = currentNodeInfo();
        const nativeLabel = textOf(current.joinButton || joinButton);
        joined = current.isMember || /已加入|退出节点|离开节点|joined/i.test(nativeLabel)
          || (!joinButton.isConnected && !current.joinButton);
        if (joined) break;
      }
      if (joined) {
        action.textContent = "已加入";
        hint.textContent = "加入成功，现在可以直接发送刚才的回复。";
        setTimeout(closePostingGate, 700);
      } else {
        action.disabled = false;
        action.textContent = "重试加入节点";
        hint.textContent = "加入尚未完成，请重试；输入内容仍会保留。";
      }
    });
    footer.appendChild(action);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "im-posting-gate-secondary";
  close.textContent = "关闭";
  close.addEventListener("click", closePostingGate);
  footer.appendChild(close);
  overlay.querySelector(".im-posting-gate-close").addEventListener("click", closePostingGate);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) closePostingGate(); });
  document.querySelector(".im-shell")?.appendChild(overlay) || document.body.appendChild(overlay);
  overlay.querySelector(joinButton ? ".im-posting-gate-primary" : ".im-posting-gate-secondary")?.focus();
}
function imageFile(file) {
  if (!file) return false;
  if (String(file.type || "").toLowerCase().startsWith("image/")) return true;
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(String(file.name || ""));
}
async function uploadImageFile(file) {
  const form = new FormData();
  form.append("file", file, file.name || "image");
  form.append("upload_type", "composer");
  form.append("type", "composer");
  form.append("synchronous", "true");
  const response = await fetch("/uploads.json", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "X-CSRF-Token": csrfToken(),
      "X-Requested-With": "XMLHttpRequest"
    },
    body: form
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = payload.errors?.[0] || payload.error || `HTTP ${response.status}`;
    throw new Error(err);
  }
  // Discourse 三种返回形态：扁平对象（新版）/ upload 包裹 / uploads 数组
  let upload = payload.upload || (Array.isArray(payload.uploads) ? payload.uploads[0] : null);
  if (!upload && payload && payload.id && payload.url) upload = payload;
  if (!upload) throw new Error("站点未返回图片地址");
  return upload;
}
function uploadedImageMarkdown(upload, file) {
  const url = upload.short_url || upload.url || upload.thumbnail_url;
  if (!url) throw new Error("站点未返回图片地址");
  const rawLabel = String(upload.original_filename || file?.name || "图片");
  const label = rawLabel.replace(/\.[^.]+$/, "").replace(/[[\]\\|]/g, "_");
  const width = Number(upload.thumbnail_width || upload.width) || 0;
  const height = Number(upload.thumbnail_height || upload.height) || 0;
  const dimensions = width > 0 && height > 0 ? `|${width}x${height}` : "";
  const safeUrl = String(url).replace(/[\\()]/g, (char) => `\\${char}`);
  return `![${label}${dimensions}](${safeUrl})`;
}
function insertComposerText(text) {
  const { input } = composeUi();
  if (!input || !text) return;
  const block = ensureActiveBlock(input);
  if (!block) return;
  const before = block.innerText;
  if (before && !/[\n ]$/.test(before)) document.execCommand("insertLineBreak");
  insertAtCaret(text);
  mdSyncActive(input);
  updateComposeSendState();
}
async function uploadComposerFiles(files) {
  const selected = [...(files || [])];
  const images = selected.filter(imageFile);
  if (!selected.length) return;
  if (composerState.uploading) {
    setComposeStatus("已有图片正在上传，请等待完成后重试", "error");
    return;
  }
  if (!images.length) {
    setComposeStatus("请选择图片文件", "error");
    return;
  }
  composerState.uploading = true;
  updateComposeSendState();
  try {
    const markdown = [];
    for (const file of images) {
      setComposeStatus(`正在上传 ${file.name || "图片"}…`, "busy");
      const upload = await uploadImageFile(file);
      registerUploadUrl(upload.short_url, upload.url || upload.thumbnail_url); // 预览条可直接出图
      markdown.push(uploadedImageMarkdown(upload, file));
    }
    insertComposerText(markdown.join("\n"));
    setComposeStatus(`已添加 ${markdown.length} 张图片`, "success");
  } catch (error) {
    setComposeStatus(`上传失败：${error.message || "未知错误"}`, "error");
  } finally {
    composerState.uploading = false;
    updateComposeSendState();
  }
}
function transferImages(event) {
  const transfer = event.clipboardData || event.dataTransfer;
  const files = [...(transfer?.files || [])];
  if (files.length) return files.filter(imageFile);
  const itemFiles = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  return itemFiles.filter(imageFile);
}
function handleComposerPaste(event) {
  const files = transferImages(event);
  if (files.length) {
    event.preventDefault();
    event.stopPropagation();
    uploadComposerFiles(files);
    return;
  }
  // 纯文本粘贴：阻止富 HTML 直插 contenteditable，统一按明文进 markdown 源
  const text = event.clipboardData?.getData?.("text/plain");
  const editor = event.target.closest?.(".im-md-edit");
  if (text && editor) {
    event.preventDefault();
    event.stopPropagation();
    insertAtCaret(text);
    mdSyncActive(editor);
    updateComposeSendState();
  }
}
function handleComposerDrop(event) {
  const files = transferImages(event);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  uploadComposerFiles(files);
}
async function submitComposer() {
  const { input } = composeUi();
  const raw = input ? mdGetSource(input) : "";
  if (!input || !raw.trim() || composerState.submitting || composerState.uploading) return;
  if (!chatState.topicId) {
    setComposeStatus("请先打开一个话题", "error");
    return;
  }
  composerState.submitting = true;
  updateComposeSendState();
  setComposeStatus("正在发送…", "busy");
  const replyTo = composerState.replyToPostNumber;
  const beforeLastNumber = chatState.renderedLastNumber;
  try {
    const post = await submitReplyViaApi(raw, replyTo);
    completeComposerSubmission(input, post);
  } catch (apiError) {
    // NodeLoc 某些插件会在帖子已经创建后仍返回通用错误；先核对服务端最新楼层。
    await new Promise((resolve) => setTimeout(resolve, 300));
    const newPosts = await fetchLatestNewPosts(chatState.topicId);
    const myName = normalizeUsername(getCurrentUsername());
    const confirmed = newPosts.find((candidate) =>
      Number(candidate.post_number) > beforeLastNumber &&
      normalizeUsername(candidate.username) === myName
    );
    const confirmedInView = [...document.querySelectorAll(".im-chat-body .im-msg[data-post-number]")].find((message) =>
      Number(message.dataset.postNumber) > beforeLastNumber &&
      normalizeUsername(message.dataset.username) === myName
    );
    if (confirmed || confirmedInView) completeComposerSubmission(input, confirmed || null);
    else {
      setComposeStatus("暂时无法回复，请查看提示", "error");
      const node = currentNodeInfo();
      showPostingGate(apiError.message || "未知错误", {
        title: /\u6210\u5458|\u52A0\u5165/.test(apiError.message || "") ? `在 ${node.label} 回复` : undefined,
        hint: /\u6210\u5458|\u52A0\u5165/.test(apiError.message || "") && node.isPublic
          ? "这是公开节点，加入后马上就能发言。"
          : undefined,
        joinButton: /\u6210\u5458|\u52A0\u5165/.test(apiError.message || "") && !node.isMember ? node.joinButton : null
      });
    }
  } finally {
    composerState.submitting = false;
    updateComposeSendState();
  }
}
function completeComposerSubmission(input, _post) {
  mdClear(input);
  composerState.replyToPostNumber = null;
  hideTargetedReply();
  setComposeStatus("发送成功", "success");
  // 不提前推进 renderedLastNumber，否则随后拉取会把刚发布的楼层过滤掉。
  const topicId = chatState.topicId;
  setTimeout(() => fetchLatestNewPosts(topicId), 120);
  setTimeout(() => syncNewPostsFromDom(), 400);
  setTimeout(() => fetchLatestNewPosts(topicId), 900);
  setTimeout(() => syncNewPostsFromDom(), 1400);
  // 抽奖插件的“必须先回复”判断来自原生 Ember topic model。IM API 直发不会让该
  // model 自动得知新楼层，因此仅在抽奖帖中定向刷新原生 route 并重新绑定操作区。
  if (document.querySelector(".im-lottery-card, .lottery-widget")) {
    document.documentElement.classList.add("im-lottery-syncing");
    setTimeout(async () => {
      try {
        await refreshNativeTopicState();
        // route 渲染与 promise 完成不一定同帧，连续两次绑定覆盖 Glimmer 延迟提交。
        requestAnimationFrame(rebindLotteryCards);
        setTimeout(rebindLotteryCards, 350);
      } finally {
        setTimeout(() => document.documentElement.classList.remove("im-lottery-syncing"), 420);
      }
    }, 350);
  }
}
function showTargetedReply(postNumber) {
  const { input, target } = composeUi();
  composerState.replyToPostNumber = Number(postNumber) || null;
  if (!target || !composerState.replyToPostNumber) return;
  const message = document.querySelector(`.im-msg[data-post-number="${postNumber}"]`);
  const name = message?.querySelector(".im-msg-name")?.textContent?.trim();
  target.querySelector("span").textContent = name ? `回复 ${name} · #${postNumber}` : `回复消息 #${postNumber}`;
  target.classList.add("active");
  input?.focus();
}
function hideTargetedReply() {
  const { target } = composeUi();
  composerState.replyToPostNumber = null;
  if (target) target.classList.remove("active");
}
function replyToPost(postNumber) {
  showTargetedReply(postNumber);
}
/** 临时让原生回复按钮可被程序点击（它们在 height:0 的 outlet 里） */
function withClickableNativeReplyControls(fn) {
  let style = document.getElementById("im-temp-reply-click");
  if (!style) {
    style = document.createElement("style");
    style.id = "im-temp-reply-click";
    style.textContent = `
      html.im-theme.im-locked #main-outlet #topic-footer-buttons,
      html.im-theme.im-locked #main-outlet .topic-footer-main-buttons,
      html.im-theme.im-locked #main-outlet .topic-footer-main-buttons *,
      html.im-theme.im-locked #main-outlet #topic-footer-buttons *,
      html.im-theme.im-locked #main-outlet .post-stream article .post-controls,
      html.im-theme.im-locked #main-outlet .post-stream article .post-controls * {
        visibility: visible !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        pointer-events: auto !important;
        position: relative !important;
      }
      html.im-theme.im-locked #main-outlet .container.posts,
      html.im-theme.im-locked #main-outlet .topic-area,
      html.im-theme.im-locked #main-outlet .post-stream,
      html.im-theme.im-locked #main-outlet .topic-footer-buttons,
      html.im-theme.im-locked #main-outlet #topic-footer-buttons {
        visibility: visible !important;
        height: auto !important;
        overflow: visible !important;
      }
    `;
    document.documentElement.appendChild(style);
  }
  try {
    return fn();
  } finally {
    setTimeout(() => {
      document.getElementById("im-temp-reply-click")?.remove();
    }, 800);
  }
}
function clickNativeReplyButton(postNumber) {
  return withClickableNativeReplyControls(() => {
    if (postNumber) {
      const article = document.querySelector(
        `.post-stream article[data-post-number="${postNumber}"], #post_${postNumber}, article[id="post_${postNumber}"]`
      );
      const postReply = article?.querySelector(
        "button.reply, .post-controls button.reply, button.create.reply, .reply.create"
      );
      if (postReply) {
        postReply.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    const topicSelectors = [
      "#topic-footer-buttons button.create",
      "#topic-footer-buttons button.btn-primary.create",
      ".topic-footer-main-buttons button.create",
      ".topic-footer-main-buttons button.btn-primary",
      "button.btn-primary.create.reply",
      "button.create.reply"
    ];
    for (const sel of topicSelectors) {
      const btn = document.querySelector(sel);
      // 避开顶栏「发新帖」
      if (!btn || btn.id === "create-topic" || btn.closest(".d-header")) continue;
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }
    return false;
  });
}
function openComposerViaService(postNumber) {
  const owner = getEmberOwner();
  if (!owner) return false;
  const composer = getComposerService(owner);
  if (!composer) return false;
  const topic = getTopicModel(owner);
  const Composer = discourseRequire("discourse/models/composer");
  const REPLY = Composer?.REPLY || Composer?.default?.REPLY || "reply";

  try {
    if (postNumber) {
      const post = findLoadedPost(topic, postNumber);
      if (post && typeof composer.replyTo === "function") {
        composer.replyTo(post);
        return true;
      }
      if (post && typeof composer.open === "function") {
        composer.open({
          action: REPLY,
          post,
          draftKey: topic?.get?.("draft_key") || topic?.draft_key || `topic_${chatState.topicId}`,
          draftSequence: topic?.get?.("draft_sequence") ?? topic?.draft_sequence
        });
        return true;
      }
    }

    if (topic && typeof composer.replyToTopic === "function") {
      composer.replyToTopic(REPLY, topic);
      return true;
    }
    if (topic && typeof composer.open === "function") {
      composer.open({
        action: REPLY,
        topic,
        draftKey: topic.get?.("draft_key") || topic.draft_key || `topic_${chatState.topicId}`,
        draftSequence: topic.get?.("draft_sequence") ?? topic.draft_sequence,
        title: topic.get?.("title") || topic.title,
        categoryId: topic.get?.("category_id") || topic.category_id
      });
      return true;
    }
  } catch (err) {
    console.warn("[nodeloc-im] composer service open failed", err);
  }
  return false;
}
function openComposerViaKeyboard(postNumber) {
  try {
    // Discourse：r = 回复话题；若先聚焦某楼再 r 可带引用——这里做话题级兜底
    if (postNumber) {
      const article = document.querySelector(
        `.post-stream article[data-post-number="${postNumber}"], #post_${postNumber}`
      );
      article?.setAttribute?.("tabindex", "-1");
      article?.focus?.();
    } else {
      document.activeElement?.blur?.();
    }
    const opts = { key: "r", code: "KeyR", keyCode: 82, which: 82, bubbles: true, cancelable: true, view: window };
    document.dispatchEvent(new KeyboardEvent("keydown", opts));
    document.body.dispatchEvent(new KeyboardEvent("keydown", opts));
    return true;
  } catch {
    return false;
  }
}
/** 打开 Discourse 原生 composer（必须真正 open，禁止只 focus textarea） */
function _openNativeComposer(postNumber) {
  try {
    flashComposeHint("正在打开编辑器…", "busy");

    if (isComposerOpen()) {
      const ta = document.querySelector(
        "#reply-control.open textarea, #reply-control.fullscreen textarea, #reply-control.open .ProseMirror"
      );
      ta?.focus?.();
      flashComposeHint("编辑器已打开", "busy");
      return true;
    }

    let opened = false;
    try { opened = !!openComposerViaService(postNumber); } catch { /* fall through */ }
    if (!opened) {
      try { opened = !!clickNativeReplyButton(postNumber); } catch { /* fall through */ }
    }
    if (!opened) {
      try { openComposerViaKeyboard(postNumber); } catch { /* fall through */ }
    }

    // 最后手段：短暂解锁 LOCK，再试一次
    setTimeout(() => {
      if (isComposerOpen()) {
        flashComposeHint("编辑器已打开", "busy");
        return;
      }
      const root = document.documentElement;
      const hadLock = root.classList.contains(LOCK_CLASS);
      const unlock = document.createElement("style");
      unlock.id = "im-unlock-for-reply";
      unlock.textContent = `
        html.im-theme.im-locked #main-outlet-wrapper,
        html.im-theme.im-locked #main-outlet,
        html.im-theme.im-locked #main-outlet > * {
          pointer-events: auto !important;
          visibility: visible !important;
          height: auto !important;
          overflow: visible !important;
        }
        html.im-theme #reply-control {
          display: block !important;
          pointer-events: auto !important;
          z-index: 600 !important;
        }
      `;
      document.documentElement.appendChild(unlock);
      if (hadLock) root.classList.remove(LOCK_CLASS);
      try {
        if (!openComposerViaService(postNumber) && !clickNativeReplyButton(postNumber)) {
          openComposerViaKeyboard(postNumber);
        }
      } catch { /* ignore */ }
      setTimeout(() => {
        if (hadLock) root.classList.add(LOCK_CLASS);
        document.getElementById("im-unlock-for-reply")?.remove();
        if (isComposerOpen()) {
          flashComposeHint("编辑器已打开", "busy");
        } else {
          flashComposeHint("打开失败：请点右上角「原生视图」回复", "error");
          console.warn("[nodeloc-im] openNativeComposer failed", {
            topicId: chatState.topicId,
            postNumber,
            hasOwner: !!getEmberOwner(),
            hasComposer: !!getComposerService(getEmberOwner())
          });
        }
      }, 250);
    }, 180);

    return true;
  } catch (err) {
    console.warn("[nodeloc-im] openNativeComposer crashed", err);
    flashComposeHint(`打开失败：${err && err.message ? err.message : "未知错误"}`, "error");
    return false;
  }
}

// chat-panel 通过 chatHooks 调用输入框绑定与定向回复（自注册，入口 import 即生效）
Object.assign(chatHooks, { wireComposer, replyToPost });



/* ---------- 发帖（新话题）：原生编辑器完整标题/分类/标签，嵌入复用 im-native-compose 浮卡 ---------- */

function openTopicComposerViaService() {
  const composer = getComposerService(getEmberOwner());
  if (!composer) return false;
  const Composer = discourseRequire("discourse/models/composer");
  const CREATE_TOPIC = Composer?.CREATE_TOPIC || Composer?.default?.CREATE_TOPIC || "createTopic";
  try {
    // 新版优先 openTopicComposer（顶栏 #create-topic 同款路径）；旧版退 open({action})
    if (typeof composer.openTopicComposer === "function") {
      composer.openTopicComposer({ draftKey: "new_topic" });
      return true;
    }
    if (typeof composer.open === "function") {
      composer.open({ action: CREATE_TOPIC, draftKey: "new_topic" });
      return true;
    }
  } catch (err) {
    console.warn("[nodeloc-im] topic composer service open failed", err);
  }
  return false;
}
function clickNativeCreateTopicButton() {
  // 顶栏被皮肤隐藏但按钮仍在 DOM：程序化 click 不依赖可见性
  const btn = document.getElementById("create-topic");
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return true;
}
function openTopicComposerViaKeyboard() {
  try {
    // Discourse 快捷键：c = 新话题
    document.activeElement?.blur?.();
    const opts = { key: "c", code: "KeyC", keyCode: 67, which: 67, bubbles: true, cancelable: true, view: window };
    document.dispatchEvent(new KeyboardEvent("keydown", opts));
    document.body.dispatchEvent(new KeyboardEvent("keydown", opts));
    return true;
  } catch {
    return false;
  }
}

let topicComposerOpening = false;

function waitForComposerOpen(timeoutMs = 600) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (isComposerOpen()) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(check, 30);
    };
    check();
  });
}

/** 中栏「发帖」入口：打开发帖编辑器，发布后 SPA 路由到新话题 */
export async function openNewTopicComposer() {
  if (topicComposerOpening) return false;
  try {
    if (!getCurrentUsername()) {
      setComposeStatus("登录后才能发帖", "error");
      return false;
    }
    if (isComposerOpen()) {
      document.querySelector("#reply-control.open textarea, #reply-control.open .ProseMirror")?.focus?.();
      return true;
    }
    topicComposerOpening = true;
    setComposeStatus("正在打开发帖编辑器…", "busy");
    let requested = false;
    try { requested = !!openTopicComposerViaService(); } catch { /* fall through */ }
    let opened = requested && await waitForComposerOpen();
    if (!opened) {
      let clicked = false;
      try { clicked = !!clickNativeCreateTopicButton(); } catch { /* fall through */ }
      opened = clicked && await waitForComposerOpen();
    }
    if (!opened) {
      openTopicComposerViaKeyboard();
      opened = await waitForComposerOpen(800);
    }
    if (opened) {
      setComposeStatus("编辑器已打开", "busy");
      return true;
    }
    setComposeStatus("打开发帖编辑器失败：请切右上角「原生视图」发帖", "error");
    console.warn("[nodeloc-im] openNewTopicComposer failed", {
      hasOwner: !!getEmberOwner(),
      hasComposer: !!getComposerService(getEmberOwner())
    });
    return false;
  } catch (err) {
    console.warn("[nodeloc-im] openNewTopicComposer crashed", err);
    setComposeStatus(`打开发帖编辑器失败：${err && err.message ? err.message : "未知错误"}`, "error");
    return false;
  } finally {
    topicComposerOpening = false;
  }
}
