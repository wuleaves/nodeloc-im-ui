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
- 钉钉顶部头像直达当前用户的 NodeLoc 原生“总结”页面，原生模式右下角可切回 IM
- 话题详情长标题完整显示并自动换行，中文、英文和连续链接均可自然断行
- NodeLoc AnyVideo 视频占位自动恢复为可播放的原生播放器，并提供原视频降级链接
- 工作台搜索框采用钉钉式单层焦点状态；应用优先复用 NodeLoc 原入口图标并统一置于原生圆角方框
- 钉钉“私信”重构为 NodeLoc 原生 Chat 全尺寸页面，直接支持直接消息、频道、搜索、历史消息和发送
- 修复 Chat 已挂载但被旧版抽屉隐藏规则遮蔽而出现的私信空白页
- Chat 内切换会话时保持左栏“私信”选中；右上角按钮可切换为自由拖动的小窗聊天
- 修复使用原生 × 关闭 Chat 后聊天模式未清理、三栏仍被隐藏的问题
- “小窗聊天”保持页内悬浮，可拖动、通过右下角自由缩放；切换主页面栏目时继续保留
- 完整加载 NodeLoc `site.json` 中的顶级分类与约 200 个节点
- NodeLoc reactions、vote、reward、lottery、red-envelope 字段的只读兼容展示
- 能量奖励在 IM 气泡内显示完整卡片，并可直接唤起 NodeLoc 原生赠送弹层；其余站点私有写操作提供“原生视图”入口
- 抽奖帖在 IM 气泡内保留状态、规则、奖品、倒计时及参与者，并可直接唤起原生购券流程
- `/apps`、`/nodes`、管理页等非标准 Topic List 页面保留原生界面
- 节点发言限制会在 IM 内显示完整原因；未加入公开节点时可直接“加入节点”，并覆盖私有/审批、只读、关闭、归档、等级、慢速模式与内容规则提示
- 修复创建话题小窗关闭时，原生草稿确认层被三栏界面隐藏而造成的页面假死
- 节点成员提示改为仅在服务端真实拒绝发送时出现；“加入节点”严格绑定当前话题节点，点击后等待并确认原生加入状态
- 自己发布的回复恢复原生删除入口；删除前二次确认，成功后同步移出 IM 消息流，失败时展示 NodeLoc 返回的原因
- 抽奖帖回复成功后同步刷新原生 Topic/抽奖组件状态，修复已回复仍被“必须先回复”旧状态拦截的问题
- 抽奖购买区通过原生组件代理完成数量调整、确认购买和随缘，避免移动原生节点后按钮失效
- 抽奖操作区恢复此前的紧凑布局，同时保留原生代理点击能力
- 抽奖参与者滚动位置在倒计时和原生组件刷新时保持稳定，拖动滚动条后不再自动跳回顶部
- 创建话题关闭时放行并美化原生舍弃草稿确认框，清除残留遮罩导致的整页假死
- 创建话题关闭采用本地即时释放，草稿网络请求转入后台，断网或高延迟不再锁死界面
- 修复首次启用偶发不生效：启动仅绑定一次，页面就绪事件采用尾随重试并带缺失界面健康检查
- 钉钉侧栏重新分工：原生 Chat 中心迁至“聊天”，“私信”恢复为站内私信列表
- 钉钉“通知”支持展开/收起分类窄栏并记忆状态；私信、书签、聊天不再在通知分类中重复显示
- 通知分类栏底部九宫格接入 NodeLoc 原生账户栏，并适配为钉钉浮层；状态、总结、活动、草稿、偏好设置、Billing 与退出保持原生功能
- “书签”栏目改用 NodeLoc 原生账户栏同源接口，兼容原生书签 URL 与响应结构并稳定显示已收藏内容

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
