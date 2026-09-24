#!/usr/bin/env node
import fs from "node:fs";

const output = fs.readFileSync("dist/nodeloc-im.user.js", "utf8");

const checks = [
  ["function ensureRail(", 1],
  ["function ensureRailDingtalk(", 1],
  ["function ensureRailFeishu(", 1],
  ["function syncRailDingtalk(", 1],
  ["function syncRailFeishu(", 1],
  ["function ensureNotifStrip(", 1],
  ["function ensureDarkModeToggle(", 1],
  ["function syncDarkModeToggle(", 1],
  ["function disguiseAvatarForTopicDingtalk(", 1],
  ["function disguiseAvatarForTopicFeishu(", 1],
  ["function renderPins(", 1],
  ["function migratePrefs(", 1],
  ["function skinCss(", 1],
  ["function ensureSkinToggle(", 1],
  ["function startAiSummary(", 1],
  ["function syncAiSummary(", 1],
  ["function isSpamPost(", 1],
  ["function openSpamConfigDialog(", 1],
  ["function highlightTitleText(", 1],
  ["function openHighlightConfigDialog(", 1],
  ["const LIST_NAV_KEY", 1],
  ["const NOTIF_STRIP_OPEN_KEY", 1],
  ["const MASK_AVATAR_KEY", 1],
  ["const MASK_TITLE_KEY", 1],
  ["const HIDE_CAT_TAGS_KEY", 1],
  ["const ORG_NAME_KEY", 1],
  ["const chatState", 1],
  ["const listState", 1],
  ["const composerState", 1],
  ["const ICONS", 1],
  ["@match        https://www.nodeloc.com/*", 1],
  ["const STYLE_ID = \"nodeloc-im-theme\"", 1],
  ["function resolveListApiPath(", 1],
  ["/__nodeloc_node__/", 1],
  ["function renderNodeLocPostExtras(", 1],
  ["<section class=\"im-plugin-card im-lottery-card\"", 1],
];

let ok = true;
for (const [needle, want] of checks) {
  const n = output.split(needle).length - 1;
  if (n !== want) {
    console.error(`self-check failed: "${needle}" occurs ${n}x, want ${want}x`);
    ok = false;
  }
}

const stray = (output.match(/class="[^"]*(?:dingtalk|feishu|wecom)-[^"]*"/g) || []).filter(
  (s) => !s.includes("linuxdo-")
);
if (stray.length) {
  console.error("stray brand classes remain: " + stray.slice(0, 5).join(" | "));
  ok = false;
}

if (output.includes("@match        https://linux.do/*") || output.includes("connect.linux.do")) {
  console.error("Linux.do-only metadata or network endpoint leaked into NodeLoc build");
  ok = false;
}

for (const marker of ["im-dd-workbench", "NodeLoc 应用与社区入口", "sidebar-section-content-discourse-apps-games"]) {
  if (!output.includes(marker)) {
    console.error(`missing DingTalk workbench marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["im-dingtalk-profile-menu", "function toggleDingtalkProfileMenu(", "#user-menu-button-profile"]) {
  if (!output.includes(marker)) {
    console.error(`missing native profile-menu marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function enhanceVideoPlaceholders(", "video-placeholder-container[data-video-src]", "im-video-fallback"]) {
  if (!output.includes(marker)) {
    console.error(`missing video compatibility marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function readNativeIcon(", "has-original-icon", "im-dd-workbench-search-wrap:focus-within"]) {
  if (!output.includes(marker)) {
    console.error(`missing workbench UI marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function openDingtalkChatHub(", "im-dingtalk-chat-hub", "im-chat-hub-open"]) {
  if (!output.includes(marker)) {
    console.error(`missing native Chat hub marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function toggleChatWindow(", "im-chat-hub-windowed", "小窗聊天"]) {
  if (!output.includes(marker)) {
    console.error(`missing draggable Chat window marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function beginResize(", "im-chat-resize-handle", "--im-chat-window-w"]) {
  if (!output.includes(marker)) {
    console.error(`missing detached Chat window marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function toggleNotifStrip(", "im-notif-strip-expanded", "5-dingtalk"]) {
  if (!output.includes(marker)) {
    console.error(`missing collapsible notification-strip marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["查看原生个人总结", "setViewMode(\"native\")", "/summary`)"]) {
  if (!output.includes(marker)) {
    console.error(`missing native avatar-summary marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["im-strip-account", "账户与更多", "data-strip-account"]) {
  if (!output.includes(marker)) {
    console.error(`missing native account-menu launcher marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function bindLotteryParticipantScroll(", "participantScrollTop", "pendingSync"]) {
  if (!output.includes(marker)) {
    console.error(`missing stable lottery-scroll marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["function bookmarkApiPath(", "user-menu-bookmarks", "bookmarkable_url"]) {
  if (!output.includes(marker)) {
    console.error(`missing native bookmark-source marker: ${marker}`);
    ok = false;
  }
}

for (const marker of [
  "im-strip-progress",
  "会员进度",
  "function nativeProfileMenuTab(",
  "stripFilters.splice(likedIndex + 1, 0"
]) {
  if (!output.includes(marker)) {
    console.error(`missing native membership-progress marker: ${marker}`);
    ok = false;
  }
}

for (const marker of ["im-native-view-toggle", "切换回 NodeLoc 原生界面", "function bindNativeViewToggle("]) {
  if (!output.includes(marker)) {
    console.error(`missing native-view toggle marker: ${marker}`);
    ok = false;
  }
}

if (ok) {
  console.log("self-check passed");
  process.exit(0);
} else {
  process.exit(1);
}
