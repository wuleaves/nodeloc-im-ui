# NodeLoc MVP 兼容说明

## 已直接复用

- Discourse 同源 JSON、CSRF、SPA 路由与 MessageBus 桥接
- 三栏外壳、主题列表、帖子气泡、回复器、搜索、用户卡、通知
- 图片灯箱、引用跳转、投票（poll）、收藏与点赞
- 三套皮肤、颜色模式、列宽调节和原生/IM 切换

## NodeLoc 专项

- 顶级分类与节点：`/site.json`
- 节点详情：`/n/<slug>.json`
- 节点主题列表：解析后使用 `/c/<slug>/<id>.json`
- 节点链接：子分类统一输出 `/n/<slug>`
- 插件数据：读取 `lottery`、`rewards`、`reactions`、`vote_score`、`red_envelope`

## 优雅降级

- 抽奖购券、能量赠送、红包领取、节点加入/管理等写操作：切换原生视图
- `/apps`、`/nodes`、`/chat` 和非标准管理/插件页面：不锁定主内容，继续使用原生 UI
- 服务端未返回插件字段时：正文 `cooked` 保持原样，不删除未知节点
- 无权限或已删除话题：显示错误并保留“打开原生页面”入口
