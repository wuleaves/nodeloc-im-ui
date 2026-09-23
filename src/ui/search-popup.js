// 飞书同款弹出搜索：rail/titlebar 搜索框点击或 ⌘K 打开居中面板，
// 数据 = Discourse 核心全文搜索 /search/query（posts/topics/users/categories/tags），
// ↑↓ 选择、↵ 打开（SPA 软跳转）、Esc 关闭；空关键词展示最近搜索（localStorage）。
import { api } from "../bridge/api.js";
import { escapeHtml } from "../utils/html.js";
import { navigateInApp } from "../bridge/router.js";
import { formatTime, stripTags } from "./shared/time.js";
import { avatarColor, avatarLetter, fullAvatarUrl } from "./shared/avatars.js";
import { ICONS } from "../config/icons.js";
import { getViewMode } from "../state/view-state.js";
import { otherThemeActive } from "../config/skins.js";

const RECENT_KEY = "linuxdo-im-search-recent";
const DEBOUNCE_MS = 220;

let recent = loadRecent();
let root = null;
let inputEl = null;
let bodyEl = null;
let moreEl = null;
let clearEl = null;
let chipsEl = null;
let debounceTimer = 0;

// 飞书 chips 行：结果类型筛选（key = item.group）
const TYPES = [
  { key: "all", label: "全部" },
  { key: "话题", label: "话题" },
  { key: "用户", label: "用户" },
  { key: "分类", label: "分类" },
  { key: "标签", label: "标签" }
];

// 高级指令：5 个下拉，点选即把指令追加进搜索框，回车/更多链接带全部指令跳 /search?q=
// token 是追加的原始指令；以 ":" 结尾或 ≤2 字符的是模板（需补参数，如 user:、@），不参与去重
const ADV_SELECTS = [
  { ph: "排序", groups: [
    { label: "按", items: [
      ["order:likes", "点赞最多"],
      ["order:latest", "最新回复"],
      ["order:oldest", "最旧回复"],
      ["order:views", "浏览最多"],
      ["order:latest_topic", "最新主题"],
      ["order:oldest_topic", "最旧主题"]
    ]}
  ]},
  { ph: "范围", groups: [
    { label: "搜索范围", items: [
      ["in:title", "仅标题"],
      ["in:first", "仅首帖"],
      ["in:replies", "仅回复"],
      ["in:all-posts", "全部帖子"],
      ["in:wiki", "Wiki"],
      ["in:pinned", "置顶"]
    ]},
    { label: "我的", items: [
      ["in:likes", "我点赞的"],
      ["in:bookmarks", "我收藏的"],
      ["in:seen", "已读"],
      ["in:unseen", "未读"]
    ]}
  ]},
  { ph: "用户", groups: [
    { label: "用户", items: [
      ["@", "@用户名 提及"],
      ["user:", "user: 发帖人"],
      ["created:", "created: 创建者"],
      ["group:", "group: 用户组"]
    ]}
  ]},
  { ph: "分类/标签", groups: [
    { label: "分类/标签", items: [
      ["category:", "category: 分类"],
      ["tags:", "tags: 标签"],
      ["#", "#标签"],
      ["-tags:", "-tags: 排除标签"]
    ]}
  ]},
  { ph: "时间/状态", groups: [
    { label: "时间", items: [
      ["after:", "after: 此后"],
      ["before:", "before: 此前"]
    ]},
    { label: "状态", items: [
      ["status:open", "开放"],
      ["status:closed", "已关闭"],
      ["status:archived", "已归档"],
      ["status:solved", "已解决"],
      ["status:noreplies", "无回复"]
    ]},
    { label: "数值", items: [
      ["min_posts:", "min_posts: 最少帖数"],
      ["max_posts:", "max_posts: 最多帖数"],
      ["min_views:", "min_views: 最少浏览"]
    ]}
  ]}
];

const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const LINK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.24 1.24"/><path d="M13.5 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.24-1.24"/></svg>`;

const state = {
  term: "",
  itemsTerm: null, // state.items 对应的关键词（防旧结果串词）
  type: "all", // 结果类型筛选（飞书 chips 行）
  loading: false,
  error: null,
  seq: 0, // 丢弃过期响应
  flat: [], // 渲染后的可导航项（含 recent）
  active: -1
};

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 8); } catch { return []; }
}
function pushRecent(term) {
  const t = (term || "").trim();
  if (!t) return;
  recent = [t, ...recent.filter((x) => x !== t)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* ignore */ }
}

function availableInIM() {
  return getViewMode() !== "native" && !otherThemeActive();
}

/* ---------- 数据整形：/q.json → 统一 item {group, href, html} ---------- */

function hl(text, term) {
  const safe = escapeHtml(String(text || ""));
  if (!term) return safe;
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return safe.replace(new RegExp(`(${escapeHtml(esc)})`, "gi"), '<span class="search-hl">$1</span>');
  } catch { return safe; }
}


function letterAvatar(name) {
  return `<span class="ava is-letter" style="background:${avatarColor(name)}">${escapeHtml(avatarLetter(name))}</span>`;
}

function buildItems(data) {
  const topicsById = new Map((data.topics || []).map((t) => [t.id, t]));
  const items = [];
  for (const p of data.posts || []) {
    const topic = topicsById.get(p.topic_id) || {};
    const title = stripTags(p.topic_title_headline || topic.title || topic.fancy_title || "");
    if (!title) continue;
    const author = p.username || "";
    items.push({
      group: "话题",
      title,
      sub: p.blurb || "",
      meta: [author, p.like_count > 0 ? `♥ ${p.like_count}` : "", formatTime(p.created_at)]
        .filter(Boolean).join(" · "),
      avatar: p.avatar_template
        ? `<img class="ava" src="${escapeHtml(fullAvatarUrl(p.avatar_template))}" alt="" loading="lazy">`
        : letterAvatar(author || "?"),
      href: `/t/${topic.slug || "topic"}/${p.topic_id}${p.post_number > 1 ? `/${p.post_number}` : ""}`
    });
  }
  for (const u of data.users || []) {
    items.push({
      group: "用户",
      title: u.username,
      sub: u.name || "",
      avatar: u.avatar_template
        ? `<img class="ava" src="${escapeHtml(fullAvatarUrl(u.avatar_template))}" alt="" loading="lazy">`
        : letterAvatar(u.username || "?"),
      href: `/u/${encodeURIComponent(u.username || "")}`
    });
  }
  for (const c of data.categories || []) {
    if (!c.name && !c.slug) continue;
    items.push({
      group: "分类",
      title: c.name || c.slug,
      avatar: `<span class="ava is-dot" style="background:#${c.color || "0088CC"}"></span>`,
      href: `/c/${encodeURIComponent(c.slug || c.id)}${c.id ? `/${c.id}` : ""}`
    });
  }
  for (const t of data.tags || []) {
    // 实测 /search/query 返回对象 {id,name,slug,topic_count}；display 用 name，链接用 slug
    const name = typeof t === "string" ? t : (t.name || t.id);
    const slug = typeof t === "string" ? t : (t.slug || t.name || t.id);
    if (!name) continue;
    const count = typeof t === "object" && t.topic_count > 0 ? `${t.topic_count} 话题` : "";
    // 非 ASCII 标签 slug 形如 `2234-tag`，裸 /tag/2234-tag 404，链接要带标签 ID
    const m = typeof slug === "string" ? /^(\d+)-tag$/.exec(slug) : null;
    items.push({ group: "标签", title: `#${name}`, sub: count, href: m ? `/tag/${slug}/${m[1]}` : `/tag/${encodeURIComponent(slug)}` });
  }
  return items;
}

/* ---------- 渲染 ---------- */

function itemHtml(it, idx, term) {
  // 飞书行布局：大头像 + 标题 / 元信息 / 摘要（两行截断）+ 悬停复制链接
  const copy = it.href
    ? `<span class="im-search-copy" title="复制链接">${LINK_SVG}</span>`
    : "";
  return `
    <a class="im-search-item${idx === state.active ? " active" : ""}" role="option" data-idx="${idx}" href="${escapeHtml(it.href)}">
      ${it.avatar || ""}
      <span class="im-search-item-main">
        <span class="tt">${hl(it.title, term)}</span>
        ${it.meta ? `<span class="meta">${escapeHtml(it.meta)}</span>` : ""}
        ${it.sub ? `<span class="sb">${hl(it.sub, term)}</span>` : ""}
      </span>
      ${copy}
    </a>`;
}

function renderChips() {
  if (!chipsEl) return;
  chipsEl.innerHTML = TYPES.map((t) =>
    `<button type="button" class="im-search-chip${t.key === state.type ? " active" : ""}" data-type="${t.key}">${t.label}</button>`
  ).join("");
}

function renderBody() {
  if (!bodyEl) return;
  const term = state.term.trim();
  let html = "";
  state.flat = [];
  state.active = -1;
  if (clearEl) clearEl.hidden = !state.term;

  if (state.loading) {
    html = `<div class="im-search-status">搜索中…</div>`;
  } else if (state.error) {
    html = `<div class="im-search-status">搜索失败（${escapeHtml(state.error)}）</div>`;
  } else if (term) {
    // 带关键词：结果仅对应当前词（旧词结果不串显），chips 行做类型过滤
    const all = state.itemsTerm === term ? state.items || [] : [];
    const items = state.type === "all" ? all : all.filter((it) => it.group === state.type);
    if (items.length) {
      let lastGroup = null;
      for (const it of items) {
        if (state.type === "all" && it.group !== lastGroup) {
          html += `<div class="im-search-group">${escapeHtml(it.group)}</div>`;
          lastGroup = it.group;
        }
        html += itemHtml(it, state.flat.length, term);
        state.flat.push(it);
      }
    } else {
      html += `<div class="im-search-status">没有找到“${escapeHtml(term)}”相关内容</div>`;
    }
  } else {
    // 空关键词：最近搜索
    if (recent.length) {
      html += `<div class="im-search-group">最近搜索</div>`;
      for (const t of recent) {
        const it = { group: "最近", title: t, href: null, recent: true };
        html += itemHtml(it, state.flat.length, "");
        state.flat.push(it);
      }
    } else {
      html += `<div class="im-search-status">输入关键词搜索话题、用户、分类</div>`;
    }
  }
  bodyEl.innerHTML = html;
  if (moreEl) {
    moreEl.hidden = !term;
    moreEl.textContent = `在全文搜索中查看“${term}”的全部结果`;
    moreEl.href = "/search?q=" + encodeURIComponent(term);
  }
}

/* ---------- 搜索与交互 ---------- */

async function runSearch(term) {
  const seq = ++state.seq;
  state.loading = true;
  state.error = null;
  renderBody();
  try {
    // 站点实测路由（原生头部搜索同款）：/search/query?term=
    const data = await api(`/search/query?term=${encodeURIComponent(term)}`);
    if (seq !== state.seq) return;
    state.items = buildItems(data);
    state.itemsTerm = term;
    state.loading = false;
    renderBody();
  } catch (err) {
    if (seq !== state.seq) return;
    state.loading = false;
    state.error = err?.message || "网络异常";
    renderBody();
  }
}

function scheduleSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const term = state.term.trim();
    if (term) runSearch(term);
    else { state.seq++; state.loading = false; state.error = null; renderBody(); }
  }, DEBOUNCE_MS);
}

/** 指令面板点选：追加 token 到搜索框；模板指令（@、user: 等需补参数）不去重，完整指令精确去重 */
function appendToken(token) {
  if (!token) return;
  const isTemplate = token.length <= 2 || token.endsWith(":");
  const cur = inputEl.value.trim();
  if (!isTemplate && cur.split(/\s+/).includes(token)) return;
  const next = cur ? `${cur} ${token}` : token;
  inputEl.value = next;
  state.term = next;
  renderBody();
  inputEl.focus();
}

function setActive(idx) {
  if (!state.flat.length) return;
  state.active = (idx + state.flat.length) % state.flat.length;
  for (const el of bodyEl.querySelectorAll(".im-search-item")) {
    el.classList.toggle("active", Number(el.dataset.idx) === state.active);
  }
  bodyEl.querySelector(`.im-search-item[data-idx="${state.active}"]`)?.scrollIntoView({ block: "nearest" });
}

function openItem(it) {
  if (!it) return;
  if (it.recent) {
    inputEl.value = it.title;
    state.term = it.title;
    runSearch(it.title);
    return;
  }
  if (state.term.trim()) pushRecent(state.term.trim());
  closeSearchPopup();
  navigateInApp(it.href);
}

function ensureRoot() {
  if (root) return root;
  root = document.createElement("div");
  root.className = "im-search-pop-overlay";
  root.innerHTML = `
    <div class="im-search-pop" role="dialog" aria-modal="true" aria-label="搜索">
      <div class="im-search-head">
        <div class="im-search-field">
          ${ICONS.search}
          <input type="search" class="im-search-input" placeholder="搜索话题、用户、分类" autocomplete="off" aria-label="搜索关键词">
          <button type="button" class="im-search-clear" hidden>清除</button>
        </div>
        <button type="button" class="im-search-close" title="退出搜索 (Esc)" aria-label="关闭">${CLOSE_SVG}</button>
      </div>
      <div class="im-search-chips" role="group" aria-label="结果类型"></div>
      <div class="im-search-body" role="listbox" aria-label="搜索结果"></div>
      <div class="im-search-adv" title="点选追加到搜索框，回车按指令全文搜索">
        ${ADV_SELECTS.map((s, i) => `
        <select class="im-search-adv-select" data-adv="${i}" aria-label="高级指令：${s.ph}">
          <option value="" disabled selected>${s.ph}</option>
          ${s.groups.map((g) =>
            `<optgroup label="${g.label}">${
              g.items.map(([token, label]) => `<option value="${escapeHtml(token)}">${label}</option>`).join("")
            }</optgroup>`
          ).join("")}
        </select>`).join("")}
        <span class="im-search-adv-hint">回车按指令搜索</span>
      </div>
      <div class="im-search-foot">
        <a class="im-search-more" href="/search" hidden></a>
        <span class="im-search-tips">
          <span><kbd>↑</kbd><kbd>↓</kbd> 移动光标</span>
          <span><kbd>↵</kbd> 选择条目</span>
          <span><kbd>esc</kbd> 退出搜索</span>
        </span>
      </div>
    </div>`;
  document.body.appendChild(root);
  inputEl = root.querySelector(".im-search-input");
  bodyEl = root.querySelector(".im-search-body");
  moreEl = root.querySelector(".im-search-more");
  clearEl = root.querySelector(".im-search-clear");
  chipsEl = root.querySelector(".im-search-chips");
  renderChips();

  root.addEventListener("mousedown", (e) => {
    if (e.target === root) closeSearchPopup(); // 点击遮罩关闭
  });
  root.querySelector(".im-search-close").addEventListener("click", closeSearchPopup);
  // 清除：回到最近搜索视图（同空词分支，不关弹层）
  clearEl.addEventListener("click", () => {
    inputEl.value = "";
    state.term = "";
    state.seq++;
    state.loading = false;
    state.error = null;
    renderBody();
    inputEl.focus();
  });
  chipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".im-search-chip[data-type]");
    if (!chip || chip.dataset.type === state.type) return;
    state.type = chip.dataset.type;
    for (const c of chipsEl.querySelectorAll(".im-search-chip")) {
      c.classList.toggle("active", c.dataset.type === state.type);
    }
    renderBody();
  });
  root.querySelector(".im-search-adv").addEventListener("change", (e) => {
    const sel = e.target.closest(".im-search-adv-select");
    if (!sel) return;
    if (sel.value) appendToken(sel.value);
    sel.selectedIndex = 0; // 回位占项，允许多次追加
  });

  inputEl.addEventListener("input", () => {
    state.term = inputEl.value;
    scheduleSearch();
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const term = state.term.trim();
      if (state.active >= 0 && state.flat[state.active]) openItem(state.flat[state.active]);
      else if (term) {
        // 无选中项：带全部指令进完整搜索页（Discourse /search?q= 原生解析）
        pushRecent(term);
        closeSearchPopup();
        navigateInApp(`/search?q=${encodeURIComponent(term)}`);
      }
    }
  });
  // 点击结果：委托 + SPA 软跳转（含 recent 关键词）；复制链接按钮拦截
  bodyEl.addEventListener("click", (e) => {
    const copy = e.target.closest(".im-search-copy");
    if (copy) {
      e.preventDefault();
      e.stopPropagation();
      const href = copy.closest(".im-search-item")?.getAttribute("href");
      if (href) navigator.clipboard?.writeText(location.origin + href).catch(() => {});
      copy.classList.add("done");
      setTimeout(() => copy.classList.remove("done"), 1200);
      return;
    }
    const el = e.target.closest(".im-search-item");
    if (!el) return;
    e.preventDefault();
    openItem(state.flat[Number(el.dataset.idx)]);
  });
  moreEl.addEventListener("click", (e) => {
    e.preventDefault();
    closeSearchPopup();
    navigateInApp(`/search?q=${encodeURIComponent(state.term.trim())}`);
  });
  return root;
}

export function openSearchPopup(prefill) {
  if (!availableInIM()) return;
  ensureRoot();
  root.classList.add("open");
  if (typeof prefill === "string" && prefill.trim() && prefill !== inputEl.value) {
    inputEl.value = prefill;
  }
  state.term = inputEl.value;
  if (state.term.trim() && state.itemsTerm !== state.term.trim()) scheduleSearch();
  document.documentElement.classList.add("im-search-open");
  renderBody();
  setTimeout(() => inputEl.focus(), 0);
}

export function closeSearchPopup() {
  if (!root) return;
  root.classList.remove("open");
  document.documentElement.classList.remove("im-search-open");
  state.seq++; // 丢弃在途响应
}

export function toggleSearchPopup() {
  if (root && root.classList.contains("open")) closeSearchPopup();
  else openSearchPopup();
}

/** ⌘K / Ctrl+K 全局快捷键；Esc 关闭（IM 模式下生效） */
export function bindSearchShortcut() {
  document.addEventListener(
    "keydown",
    (e) => {
      if (!availableInIM()) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        toggleSearchPopup();
        return;
      }
      if (e.key === "Escape" && root && root.classList.contains("open")) {
        e.preventDefault();
        closeSearchPopup();
      }
    },
    true
  );
}

/** rail / titlebar 搜索框接管：只作入口（readonly），点击弹出搜索面板 */
export function bindSearchTrigger(host, { placeholder } = {}) {
  const input = host?.querySelector("input");
  if (!host || !input || host.dataset.searchBound === "1") return;
  host.dataset.searchBound = "1";
  input.readOnly = true;
  if (placeholder) input.placeholder = placeholder;
  host.addEventListener("mousedown", (e) => {
    // 不聚焦窄输入框，焦点直接交给弹层
    e.preventDefault();
    openSearchPopup();
  });
}
