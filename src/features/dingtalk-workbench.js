import { ICONS } from "../config/icons.js";
import { navigateInApp } from "../bridge/router.js";
import { escapeHtml } from "../utils/html.js";

const SECTION_SPECS = [
  { title: "游戏", controls: ["sidebar-section-content-discourse-apps-games"], icon: "rocket", fallback: [["游戏中心", "/apps"]] },
  { title: "小程序", controls: ["sidebar-section-content-discourse-apps-applets"], icon: "apps", fallback: [["全部小程序", "/apps"]] },
  { title: "自定义信息流", controls: ["sidebar-section-content-custom-feeds"], icon: "spark", fallback: [["最新话题", "/latest"], ["热门话题", "/hot"]] },
  { title: "节点", controls: ["sidebar-section-content-communities", "sidebar-section-content-categories"], icon: "grid", fallback: [["全部节点", "/nodes"], ["我的节点", "/my-nodes"]] },
  { title: "标签", controls: ["sidebar-section-content-tags"], icon: "bookmark", fallback: [["全部标签", "/tags"]] },
  { title: "资源", controls: ["sidebar-section-content-resources"], icon: "book", fallback: [["NodeLoc 文档", "https://docs.nodeloc.com"], ["社区指南", "/guidelines"]] },
];

const APP_COLORS = [
  ["#E7F2FF", "#1683FF"], ["#E8FBF4", "#08A870"], ["#FFF4E1", "#F59A23"],
  ["#F0ECFF", "#7655E7"], ["#FFECEC", "#E85656"], ["#E8F9FF", "#1B9FD6"],
];

function safeHref(raw) {
  const href = String(raw || "").trim();
  if (href.startsWith("/")) return href;
  try {
    const url = new URL(href, location.origin);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch { /* ignore malformed links */ }
  return "";
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.href}\n${item.label}`;
    if (!item.href || !item.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 读取原生侧栏入口自己的图标。优先图片，其次保留 Discourse SVG sprite 引用。 */
function readNativeIcon(link) {
  const img = link.querySelector(".sidebar-section-link-prefix img, img.sidebar-section-link-prefix, img");
  if (img) {
    const src = safeHref(img.currentSrc || img.getAttribute("src"));
    if (src) return `<img src="${escapeHtml(src)}" alt="">`;
  }
  const svg = link.querySelector(".sidebar-section-link-prefix svg, svg.prefix-icon, svg");
  if (!svg) return "";
  const clone = svg.cloneNode(true);
  clone.querySelectorAll("script, style, foreignObject").forEach((node) => node.remove());
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      if ((attr.name === "href" || attr.name === "xlink:href") && !attr.value.startsWith("#")) {
        node.removeAttribute(attr.name);
      }
    }
  }
  clone.removeAttribute("style");
  clone.setAttribute("aria-hidden", "true");
  clone.setAttribute("focusable", "false");
  return clone.outerHTML;
}

async function expandNativeSections() {
  const buttons = SECTION_SPECS.flatMap((spec) => spec.controls)
    .map((id) => document.querySelector(`.sidebar-section-header[aria-controls="${id}"]`))
    .filter(Boolean);
  for (const button of buttons) {
    if (button.getAttribute("aria-expanded") !== "true") button.click();
  }
  if (buttons.length) await new Promise((resolve) => setTimeout(resolve, 180));
}

function readNativeSection(spec) {
  const items = [];
  for (const id of spec.controls) {
    const root = document.getElementById(id);
    if (!root) continue;
    for (const link of root.querySelectorAll("a[href]")) {
      const label = (link.textContent || link.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const href = safeHref(link.getAttribute("href"));
      if (label && href) items.push({ label, href, iconHtml: readNativeIcon(link) });
    }
  }
  const nativeItems = dedupe(items);
  if (nativeItems.length) return nativeItems;
  return spec.fallback.map(([label, href]) => ({ label, href, iconHtml: "" }));
}

function appHtml(item, spec, index) {
  const [bg, color] = APP_COLORS[index % APP_COLORS.length];
  const icon = item.iconHtml || ICONS[spec.icon] || ICONS.apps;
  const original = item.iconHtml ? " has-original-icon" : "";
  return `<button type="button" class="im-dd-app" data-href="${escapeHtml(item.href)}" data-label="${escapeHtml(item.label.toLowerCase())}">
    <span class="im-dd-app-icon${original}" style="--app-bg:${bg};--app-color:${color}">${icon}</span>
    <span class="im-dd-app-name">${escapeHtml(item.label)}</span>
  </button>`;
}

function renderSections(panel) {
  const body = panel.querySelector(".im-dd-workbench-body");
  if (!body) return;
  body.innerHTML = SECTION_SPECS.map((spec, sectionIndex) => {
    const items = readNativeSection(spec);
    return `<section class="im-dd-app-section" data-section="${escapeHtml(spec.title)}">
      <h2>${escapeHtml(spec.title)}</h2>
      <div class="im-dd-app-grid">${items.map((item, index) => appHtml(item, spec, sectionIndex + index)).join("")}</div>
    </section>`;
  }).join("");
}

function bindWorkbench(panel) {
  if (panel.dataset.bound === "1") return;
  panel.dataset.bound = "1";
  panel.querySelector(".im-dd-workbench-close")?.addEventListener("click", closeDingtalkWorkbench);
  panel.querySelector(".im-dd-workbench-search")?.addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    for (const app of panel.querySelectorAll(".im-dd-app")) {
      app.hidden = !!query && !String(app.dataset.label || "").includes(query);
    }
    for (const section of panel.querySelectorAll(".im-dd-app-section")) {
      section.hidden = !section.querySelector(".im-dd-app:not([hidden])");
    }
  });
  panel.addEventListener("click", (event) => {
    const app = event.target.closest(".im-dd-app[data-href]");
    if (!app || !panel.contains(app)) return;
    const href = safeHref(app.dataset.href);
    if (!href) return;
    closeDingtalkWorkbench();
    if (/^https?:/i.test(href) && new URL(href, location.origin).origin !== location.origin) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    navigateInApp(href);
  });
}

export function closeDingtalkWorkbench() {
  document.querySelector(".im-dd-workbench")?.remove();
  document.documentElement.classList.remove("im-workbench-open");
  document.querySelector('.im-rail-item[data-rail-key="work"]')?.classList.remove("active");
  const more = document.querySelector(".im-rail-more");
  more?.classList.remove("is-on");
  if (more) {
    more.title = "打开工作台";
    more.setAttribute("aria-expanded", "false");
  }
}

export async function openDingtalkWorkbench() {
  let panel = document.querySelector(".im-dd-workbench");
  if (!panel) {
    panel = document.createElement("section");
    panel.className = "im-dd-workbench";
    panel.setAttribute("aria-label", "工作台");
    panel.innerHTML = `<header class="im-dd-workbench-head">
      <div><h1>工作台</h1><p>NodeLoc 应用与社区入口</p></div>
      <label class="im-dd-workbench-search-wrap">${ICONS.search}<input class="im-dd-workbench-search" type="search" placeholder="搜索应用" aria-label="搜索应用"></label>
      <button type="button" class="im-dd-workbench-close" aria-label="关闭工作台">×</button>
    </header>
    <div class="im-dd-workbench-body"><div class="im-dd-workbench-loading">正在加载应用…</div></div>`;
    document.body.appendChild(panel);
    bindWorkbench(panel);
  }
  document.documentElement.classList.add("im-workbench-open");
  document.querySelectorAll(".im-rail-item[data-rail-key]").forEach((button) => {
    button.classList.toggle("active", button.dataset.railKey === "work");
  });
  const more = document.querySelector(".im-rail-more");
  more?.classList.add("is-on");
  if (more) {
    more.title = "工作台已打开";
    more.setAttribute("aria-expanded", "true");
  }
  await expandNativeSections();
  if (document.body.contains(panel)) renderSections(panel);
}
