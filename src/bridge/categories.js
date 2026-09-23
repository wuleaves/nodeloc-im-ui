import { api } from "./api.js";

let categoriesCache = null; // NodeLoc 顶级分类 + 节点（子分类）

export async function loadCategories() {
  if (categoriesCache) return categoriesCache;
  try {
    // NodeLoc 的 /categories.json 只返回 11 个顶级分类；完整的约 200 个节点
    // 都在 Discourse site serializer 中。列表和帖子页必须用它才能解析 category_id。
    const data = await api("/site.json");
    categoriesCache = Array.isArray(data.categories) ? data.categories : [];
  } catch {
    try {
      const data = await api("/categories.json");
      categoriesCache = data.category_list?.categories || [];
    } catch {
      categoriesCache = [];
    }
  }
  return categoriesCache;
}
export function categoryById(id) {
  return (categoriesCache || []).find((c) => Number(c.id) === Number(id)) || null;
}

export function categoryBySlug(slug) {
  const key = String(slug || "").toLowerCase();
  return (categoriesCache || []).find((c) => String(c.slug || "").toLowerCase() === key) || null;
}

export function isNodeCategory(category) {
  return !!category?.parent_category_id;
}

export function categoryHref(category) {
  if (!category) return "/nodes";
  if (isNodeCategory(category)) return `/n/${encodeURIComponent(category.slug)}`;
  return `/c/${encodeURIComponent(category.slug)}/${category.id}`;
}
