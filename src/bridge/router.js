import { discourseRequire } from "./discourse.js";
import { pg } from "./page.js";

/** 站内软跳转后重应用布局；由入口注册 */
let applyHook = null;
export function onRouteApply(fn) { applyHook = fn; }

export function isTopicPath(pathname) {
  return /^\/t\//.test(pathname);
}
export function topicIdFromPath(pathname) {
  const m = pathname.match(/^\/t\/(?:[\w-]+\/)?(\d+)/);
  return m ? Number(m[1]) : null;
}
/** 路由携带的楼层号（/t/[slug/]id/N），无则 0 */
export function postNumberFromPath(pathname) {
  const m = pathname.match(/^\/t\/(?:[\w-]+\/)?\d+(?:\/(\d+))?/);
  return m && m[1] ? Number(m[1]) : 0;
}
export function isHomePath(pathname) {
  return pathname === "/" ||
    /^\/(latest|new|unread|unseen|top|categories|hot|posted|read|bookmarks)\b/.test(pathname) ||
    /^\/c\//.test(pathname) || /^\/tag\//.test(pathname);
}
/** 列表排序参数（order/ascending）从当前 URL 提取，追加到列表端点 query */
function listSortQuery(search) {
  const sp = new URLSearchParams(search);
  const p = new URLSearchParams();
  for (const k of ["order", "ascending"]) {
    const v = sp.get(k);
    if (v) p.set(k, v);
  }
  return p.toString();
}
/** 中栏列表 JSON 端点按路由映射 */
export function listApiForPath(urlOrPath) {
  let path = urlOrPath || "";
  let search = "";
  const qIdx = path.indexOf("?");
  if (qIdx !== -1) {
    search = path.slice(qIdx);
    path = path.slice(0, qIdx);
  }
  const searchParams = new URLSearchParams(search);
  const sort = listSortQuery(search);
  const q = (base) => {
    const s = [base, sort].filter(Boolean).join("&");
    return s ? `?${s}` : "";
  };

  if (path === "/" || path === "/latest") return "/latest.json" + q("");
  if (path === "/new") {
    const subset = searchParams.get("subset");
    return "/new.json" + q(subset === "topics" || subset === "replies" ? `subset=${subset}` : "");
  }
  if (path === "/unread" || path === "/unseen") return "/unseen.json" + q("");
  if (path === "/top") return "/top.json" + q(searchParams.get("period") ? `period=${searchParams.get("period")}` : "");
  const top = path.match(/^\/top\/(weekly|monthly|quarterly|yearly|all)$/);
  if (top) return "/top.json" + q(`period=${top[1]}`);
  if (path === "/hot") return "/hot.json" + q("");
  if (path === "/posted") return "/posted.json" + q("");
  if (path === "/read") return "/read.json" + q("");
  if (path === "/bookmarks") return "/bookmarks.json" + q("");
  // 类别页本身不是话题流；中栏仍拉 latest，避免 categories.json 无 topic_list
  if (path === "/categories") return "/latest.json" + q("");
  const c = path.match(/^\/c\/([\w-]+(?:\/[\w-]+)?)/);
  if (c) return `/c/${c[1]}.json` + q("");
  const t = path.match(/^\/tag\/([\w-]+)(?:\/(\d+))?/);
  if (t) {
    // 中文等标签的 slug 形如 `2234-tag`，裸 /tag/2234-tag 会 404，必须带标签 ID
    const id = t[2] || (/^(\d+)-tag$/.exec(t[1]) || [])[1];
    return `/tag/${t[1]}${id ? `/${id}` : ""}.json` + q("");
  }
  return "/latest.json" + q("");
}

/** 站内软跳转：避免中栏自定义链接触发浏览器整页重载 */
function discourseRouteTo(url) {
  if (!url) return false;
  try {
    const mod = discourseRequire("discourse/lib/url");
    const DiscourseURL = mod?.default || mod;
    if (DiscourseURL && typeof DiscourseURL.routeTo === "function") {
      DiscourseURL.routeTo(url);
      return true;
    }
  } catch { /* ignore */ }
  try {
    if (typeof pg.Discourse?.URL?.routeTo === "function") {
      pg.Discourse.URL.routeTo(url);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
export function navigateInApp(url) {
  if (!url) return;
  // 绝对地址收成站内路径
  let path = url;
  try {
    if (/^https?:/i.test(url)) path = new URL(url, location.origin).pathname + new URL(url, location.origin).search + new URL(url, location.origin).hash;
  } catch { /* keep url */ }
  // IM 观感：进入话题固定从第 1 楼打开（原生隐藏流窗口随之对齐）
  {
    const cut = /[?#]/.exec(path);
    const base = cut ? path.slice(0, cut.index) : path;
    if (/^\/t\/[^/]+\/\d+$/.test(base)) {
      path = `${base}/1${cut ? path.slice(cut.index) : ""}`;
    }
  }
  if (discourseRouteTo(path)) {
    applyHook?.();
    return;
  }
  history.pushState({}, "", path);
  applyHook?.();
}
