import { pg } from "./page.js";

export function discourseRequire(moduleId) {
  try {
    if (typeof pg.require === "function") return pg.require(moduleId);
  } catch { /* module missing */ }
  return null;
}

export function safeLookup(owner, key) {
  if (!owner || typeof owner.lookup !== "function") return null;
  try {
    return owner.lookup(key);
  } catch {
    return null;
  }
}

export function getEmberOwner() {
  try {
    if (pg.Discourse?.__container__) return pg.Discourse.__container__;

    // Ember.Namespace 反查 Discourse 应用
    const Ember = pg.Ember;
    const namespaces = Ember?.Namespace?.NAMESPACES;
    if (Array.isArray(namespaces)) {
      const app = namespaces.find((n) =>
        n && (n.name === "Discourse" || n.modulePrefix === "discourse" || n.NAMESPACE === "Discourse")
      );
      if (app?.__container__) return app.__container__;
      if (typeof app?.lookup === "function") return app;
    }

    const mod =
      discourseRequire("discourse-common/lib/get-owner") ||
      discourseRequire("discourse/lib/get-owner");
    if (mod) {
      const owner =
        (typeof mod.getOwnerWithFallback === "function" && mod.getOwnerWithFallback(pg.Discourse)) ||
        (typeof mod.getOwner === "function" && mod.getOwner(pg.Discourse)) ||
        null;
      if (owner) return owner;
    }

    try {
      const appMod = discourseRequire("discourse/app");
      const app = appMod?.default || appMod;
      if (app?.__container__) return app.__container__;
      if (typeof app?.lookup === "function") return app;
    } catch { /* ignore */ }
  } catch (err) {
    console.warn("[nodeloc-im] getEmberOwner failed", err);
  }
  return null;
}

export function getComposerService(owner) {
  return safeLookup(owner, "service:composer") || safeLookup(owner, "controller:composer");
}

export function getTopicModel(owner) {
  const topicController = safeLookup(owner, "controller:topic");
  if (!topicController) return null;
  try {
    return topicController.get?.("model") || topicController.model || null;
  } catch {
    return null;
  }
}

export function findLoadedPost(topic, postNumber) {
  if (!topic || !postNumber) return null;
  try {
    const stream = topic.get?.("postStream") || topic.postStream;
    const posts = stream?.get?.("posts") || stream?.posts || [];
    return [...posts].find((p) =>
      Number(p?.get?.("post_number") ?? p?.post_number) === Number(postNumber)
    ) || null;
  } catch { /* ignore */ }
  return null;
}

export function isComposerOpen() {
  const el = document.querySelector("#reply-control");
  return !!(el && (el.classList.contains("open") || el.classList.contains("fullscreen") || el.classList.contains("edit-title")));
}

/**
 * IM 通过 /posts.json 直发后，Discourse 隐藏的 topic route 不会自动刷新。
 * NodeLoc 抽奖等 Ember 插件会继续读取旧 topic model（例如“当前用户是否已回复”），
 * 因此需要刷新原生 route，但不重载整个页面。
 */
export async function refreshNativeTopicState() {
  const owner = getEmberOwner();
  if (!owner) return false;
  try {
    const topicRoute = safeLookup(owner, "route:topic");
    if (typeof topicRoute?.refresh === "function") {
      await Promise.resolve(topicRoute.refresh());
      return true;
    }
    const router = safeLookup(owner, "service:router");
    if (typeof router?.refresh === "function") {
      await Promise.resolve(router.refresh());
      return true;
    }
  } catch (error) {
    console.warn("[nodeloc-im] refresh native topic state failed", error);
  }
  return false;
}
