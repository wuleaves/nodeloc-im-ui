import { escapeHtml } from "../utils/html.js";
import { fullAvatarUrl } from "../ui/shared/avatars.js";

const REACTION_GLYPHS = {
  heart: "♥", "+1": "👍", "-1": "👎", laugh: "😄", hooray: "🎉",
  confused: "😕", eyes: "👀", rocket: "🚀", tada: "🎉"
};

function formatDate(value) {
  if (!value) return "";
  try { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
  catch { return String(value); }
}

function nativeAction(label = "在原生视图中操作", action = "native", postNumber = 0) {
  return `<button type="button" class="im-plugin-native" data-im-native-plugin="1" data-im-plugin-action="${escapeHtml(action)}" data-post-number="${Number(postNumber) || 0}">${escapeHtml(label)}</button>`;
}

function renderReactions(post) {
  const reactions = Array.isArray(post.reactions) ? post.reactions.filter((r) => Number(r.count) > 0) : [];
  if (!reactions.length) return "";
  return `<div class="im-plugin-reactions" aria-label="回应">${reactions.map((r) => {
    const glyph = REACTION_GLYPHS[r.id] || r.id || "•";
    const active = post.current_user_reaction === r.id ? " active" : "";
    return `<button type="button" class="im-reaction-chip${active}" data-im-native-plugin="1" title="${escapeHtml(r.id || "回应")} · 在原生视图中选择回应"><b>${escapeHtml(glyph)}</b>${Number(r.count)}</button>`;
  }).join("")}</div>`;
}

function renderVote(post) {
  const score = Number(post.vote_score);
  const count = Number(post.vote_count);
  if (!Number.isFinite(score) || (!score && !count && !post.can_vote)) return "";
  const userVote = Number(post.user_vote || 0);
  const upActive = post.user_voted === true || userVote > 0;
  const downActive = post.user_downvoted === true || userVote < 0;
  return `<div class="im-plugin-vote" role="group" aria-label="赞踩投票">
    <button type="button" class="im-plugin-vote-btn${upActive ? " active" : ""}" data-im-native-plugin="1" data-im-plugin-action="vote-up" data-post-number="${Number(post.post_number) || 0}" title="赞">↑</button>
    <span class="im-plugin-vote-score" title="NodeLoc 投票分数">${score > 0 ? "+" : ""}${score}</span>
    <button type="button" class="im-plugin-vote-btn${downActive ? " active" : ""}" data-im-native-plugin="1" data-im-plugin-action="vote-down" data-post-number="${Number(post.post_number) || 0}" title="踩">↓</button>
  </div>`;
}

function renderRewards(post) {
  const rewards = Array.isArray(post.rewards) ? post.rewards : [];
  if (!rewards.length) return "";
  const total = rewards.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const people = rewards.slice(0, 8).map((r) => {
    const avatar = r.avatar_template
      ? `<img src="${escapeHtml(fullAvatarUrl(r.avatar_template))}" alt="" loading="lazy">`
      : `<span>${escapeHtml((r.username || "?").slice(0, 1).toUpperCase())}</span>`;
    return `<a href="/u/${encodeURIComponent(r.username || "")}" title="${escapeHtml(`${r.username || "用户"} · ${r.amount || 0} NL`)}">${avatar}</a>`;
  }).join("");
  return `<section class="im-plugin-card im-reward-card">
    <div class="im-plugin-head"><strong>能量奖励</strong><span>${rewards.length} 人 · ${total} NL</span></div>
    <div class="im-reward-people">${people}${rewards.length > 8 ? `<span>+${rewards.length - 8}</span>` : ""}</div>
    ${nativeAction("查看或赠送能量", "reward", post.post_number)}
  </section>`;
}

function renderLottery(post) {
  const lottery = post.lottery;
  if (!lottery) return "";
  const statusLabel = { pending: "待开奖", active: "进行中", drawn: "已开奖", closed: "已结束", cancelled: "已取消" }[lottery.status] || lottery.status || "抽奖";
  const levels = (lottery.levels || []).map((level) =>
    `<li><strong>${escapeHtml(level.name || "奖项")}</strong><span>${escapeHtml(level.prize || "奖品")} × ${Number(level.quantity) || 1}</span></li>`
  ).join("");
  const winners = (lottery.winners || []).map((winner) =>
    `<a href="/u/${encodeURIComponent(winner.username || "")}">${escapeHtml(winner.username || "获奖者")} · ${escapeHtml(winner.prize || winner.level_name || "奖品")}</a>`
  ).join("");
  return `<section class="im-plugin-card im-lottery-card">
    <div class="im-plugin-head"><strong>🎟 ${escapeHtml(lottery.title || "NodeLoc 抽奖")}</strong><span class="status">${escapeHtml(statusLabel)}</span></div>
    <div class="im-plugin-meta">
      ${lottery.draw_at ? `<span>开奖 ${escapeHtml(formatDate(lottery.draw_at))}</span>` : ""}
      <span>${Number(lottery.participants_count) || 0} 人参与</span>
      <span>${Number(lottery.tickets_count) || 0} 张奖券</span>
      ${Number(lottery.user_tickets) > 0 ? `<span>我有 ${Number(lottery.user_tickets)} 张</span>` : ""}
    </div>
    ${levels ? `<ul class="im-plugin-prizes">${levels}</ul>` : ""}
    ${winners ? `<div class="im-plugin-winners"><b>获奖者</b>${winners}</div>` : ""}
    ${nativeAction(["active", "open"].includes(lottery.status) ? "参与抽奖" : "查看完整抽奖", "lottery", post.post_number)}
  </section>`;
}

function renderRedEnvelope(post) {
  const envelope = post.red_envelope;
  if (!envelope) return "";
  const label = envelope.title || envelope.name || "NodeLoc 红包";
  const state = envelope.status || envelope.state || "";
  return `<section class="im-plugin-card im-envelope-card">
    <div class="im-plugin-head"><strong>🧧 ${escapeHtml(label)}</strong><span>${escapeHtml(state)}</span></div>
    <p>红包领取与余额操作保留在 NodeLoc 原生组件中。</p>
    ${nativeAction("打开原生红包")}
  </section>`;
}

export function renderNodeLocPostExtras(post) {
  const cards = [renderLottery(post), renderRewards(post), renderRedEnvelope(post)].filter(Boolean).join("");
  const inline = renderReactions(post) + renderVote(post);
  if (!cards && !inline) return "";
  return `<div class="im-nodeloc-extras">${cards}${inline ? `<div class="im-plugin-inline">${inline}</div>` : ""}</div>`;
}
