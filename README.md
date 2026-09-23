# NodeLoc · IM 外观 userscript

把 [NodeLoc](https://www.nodeloc.com/) 的 Discourse 界面重组为三栏 IM 布局。项目基于
[czm15053/linuxdo-idea-ui](https://github.com/czm15053/linuxdo-idea-ui/tree/main/im)
的 `im` 架构适配，保留钉钉、飞书、企业微信三套皮肤。

## MVP 功能

- 三栏布局：左侧导航、中栏主题列表、右侧帖子流
- NodeLoc 首页、标准 Discourse 列表、标签、分类和 `/n/<slug>` 节点路由
- 主题详情、分页加载、楼层跳转、引用、回复与原生编辑器兜底
- 全局搜索、用户卡/资料页、通知、私信与书签
- 浅色、深色、跟随系统；三套皮肤即时切换
- 钉钉皮肤原生风工作台：游戏、小程序、信息流、节点、标签和资源改为应用宫格
- 钉钉头像个人菜单：复用 NodeLoc 原生状态、活动、草稿、偏好设置、Billing 与退出功能，并适配为钉钉式浮层
- 话题详情长标题完整显示并自动换行，中文、英文和连续链接均可自然断行
- 完整加载 NodeLoc `site.json` 中的顶级分类与约 200 个节点
- NodeLoc reactions、vote、reward、lottery、red-envelope 字段的只读兼容展示
- 对抽奖购券、能量赠送、红包领取等站点私有写操作，提供“原生视图”入口
- `/apps`、`/nodes`、管理页等非标准 Topic List 页面保留原生界面

## 安装

1. 安装 Tampermonkey 或 Violentmonkey。
2. 打开 `dist/nodeloc-im.user.js`，由用户脚本管理器安装。
3. 访问 <https://www.nodeloc.com/> 并刷新一次。

脚本仅匹配 `https://www.nodeloc.com/*`，且不注入 iframe。

## NodeLoc 兼容策略

NodeLoc 的“节点”底层仍是 Discourse Category，但 `/categories.json` 只返回顶级分类。
本项目改为从 `/site.json` 读取完整分类树，并将 `/n/<slug>` 先解析到 `/n/<slug>.json`，
再请求标准 `/c/<slug>/<id>.json` 主题列表。

帖子正文继续直接使用服务端 `cooked` HTML，尽量保留站点原生内容。抽奖、奖励、回应、
投票等插件如果把数据放在 JSON 的独立字段中，则渲染为 IM 内兼容卡片；未知或需要交易的
交互不猜测私有 API，切换到 NodeLoc 原生视图完成。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm lint
```

构建产物：`dist/nodeloc-im.user.js`。

## 主要适配文件

- `src/meta.js`：NodeLoc match、名称、图标与版本
- `src/bridge/categories.js`：完整节点/分类映射
- `src/bridge/router.js`：`/n/<slug>` 到分类列表 JSON 的解析
- `src/ui/list-panel.js`：节点列表加载与缓存键
- `src/ui/chat-panel.js`：NodeLoc 分类链接、帖子插件扩展与原生降级
- `src/features/nodeloc-plugins.js`：lottery/reward/reactions/vote/red-envelope 兼容卡
- `src/features/dingtalk-workbench.js`：读取原生侧栏入口并渲染钉钉应用工作台
- `src/config/*`：独立的 `nodeloc-im-*` 本地偏好键，避免与 Linux.do 版本冲突

## 许可与来源

原项目以 MIT License 发布，版权归原作者 czm15053 所有。本适配保留原项目结构、
版权声明与许可文本；新增适配代码同样按 MIT License 分发。
