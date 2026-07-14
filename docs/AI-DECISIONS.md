# MarkZ AI Decisions

这里记录会影响后续 AI 决策的用户纠偏和架构约束。新记录必须包含触发、决策、反例、边界和锁定证据。

## D-001 视觉修改必须进入系统

- 日期：2026-07-10
- 触发：用户明确指出，不能把确认的字标写完即止；必须形成统一视觉和可持续 AI 基建。
- 决策：建立机器可读设计令牌、生成链、统一 `BrandMark`、设计规范、项目 Skill、评测样例和自动门禁。
- 反例：在某个 TSX 或 SCSS 中直接新增颜色、宽度或另一份 `MarkZ.` HTML，然后只检查当前截图。
- 边界：独立工具产品保留自己的产品身份；共享域名不等于共享产品名称。
- 锁定证据：`npm run design:check`、`npm run ai:check`、`scripts/design-system/check.test.mjs`。

## D-002 公网入口只能由 markz-edge 持有

- 日期：2026-07-10
- 触发：JSONUtils 部署多次把 `markz.fun` 覆盖为工具首页。
- 决策：独立 `markz-edge` 持有宿主机 `80/443`；JSONUtils 前端只暴露 Docker 内网端口。
- 反例：通过 `docker-compose.override.yml` 把博客 Nginx 配置挂进 JSONUtils 前端，或在 JSONUtils Compose 中重新发布 `80/443`。
- 边界：edge 可以读取 JSONUtils 静态卷并代理 API，但 JSONUtils 部署不能拥有公网路由生命周期。
- 锁定证据：`deploy/docker-compose.edge.yml`、`deploy/nginx.conf`、`npm run ai:check` 和部署后端口检查。

## D-003 博客、笔记和工具保持角色分离

- 日期：2026-07-10
- 触发：用户认为早期主页像笔记前端，而不是个人博客。
- 决策：博客展示整理后的文章；笔记站保留网络化原始材料；工具使用独立产品身份。三者通过链接连接，不合并信息架构。
- 反例：在博客首页铺完整笔记树，或把 JSONUtils、装箱单统一改名为 MarkZ。
- 边界：博客和笔记共享个人字标、基础字体和色彩，不共享页面密度与工作流布局。
- 锁定证据：`design-system/manifest.json`、`docs/DESIGN-SYSTEM.md`、`npm run design:check`。

## D-004 字标采用粗体无衬线视觉

- 日期：2026-07-10
- 触发：用户确认新的浅底、深色粗体无衬线 `MarkZ.` 字标比等宽版本更合适。
- 决策：MarkZ v2 字标统一使用 `Noto Sans SC 800`，保留 `0.23em` 蓝点比例；网页、favicon 和分享图都从同一令牌生成。
- 反例：只替换首页字体，或让笔记、favicon、分享图继续使用旧等宽字标。
- 边界：文章代码字体仍使用 `JetBrains Mono`；本决策只改变个人品牌字标，不改变独立工具身份。
- 锁定证据：`design-system/reference/markz-wordmark.png`、`brand.wordmarkFont`、`brand.assetRevision=v2`、`npm run design:check`。

## D-005 AI 与视觉规范必须有可执行证据

- 日期：2026-07-11
- 触发：用户要求继续对标顶尖项目，形成完整视觉方案和完善 AI 基建，服务后续迭代。
- 决策：引入分层视觉令牌、320/390/1440 浏览器矩阵、WCAG 自动审计、构建质量预算、机器可读 AI manifest、路径级指令、可复用 prompt 和确定性 eval runner。
- 反例：继续增加说明文档，但 CI 不读取、任务无法重复运行、Agent 仍可绕过真实页面验收。
- 边界：自动检查提供基线证据，不替代用户审美判断、人工无障碍检查和高风险部署复核。
- 锁定证据：`ai/manifest.json`、设计 token 对比度测试、High Contrast 代码主题、语义 `<main>`、可聚焦滚动容器、`npm run evals:check`、`npm run quality:build`、`npm run quality:web`、CI 浏览器报告。

## D-006 公开代码与私有内容分离

- 日期：2026-07-11
- 触发：用户要求项目开源，并确认项目 Skill 不应安装到个人目录，同时询问 note 仓库是否需要承担同步 Action。
- 决策：Skill 保留在项目 `.codex/skills/`；`zhang99667/blog` 公开代码，`zhang99667/note` 保持私有。blog Action 主动签出 note 并负责定时构建、校验和部署；生成内容不进入公开 Git 历史。
- 反例：把 Skill 安装到 `~/.codex/skills`、将原始 note 或生成内容提交到公开仓库、让 note Action 持有服务器 SSH 私钥。
- 边界：若需要 push 后即时发布，note 可以用最小权限令牌发送 `notes-updated` dispatch，但同步与部署实现仍只存在于 blog。
- 锁定证据：`.gitignore`、`.github/workflows/markz-verify.yaml`、`.github/workflows/markz-publish.yaml`、`NOTE_REPO_PRECHECKED_OUT` 和 `npm run ai:check`。

## D-007 公开日期不依赖同步时间

- 日期：2026-07-13
- 触发：用户发现每次自动同步后，笔记日期都会整体更新成同步当天。
- 决策：同步器以源 frontmatter 为最高优先级，否则读取 note 文件的 Git 首次和最近提交时间，并把稳定的 `created`、`modified` 写入生成 Markdown。Quartz 先读 frontmatter，不能只读文件系统时间。
- 反例：使用源 checkout 的 `mtime`、生成文件的 `mtime` 或 Action 运行时间作为笔记日期。
- 边界：未纳入 Git 且没有日期 frontmatter 的本地新文件可以暂时回退到文件系统时间；CI 发布的文件必须有完整 Git 历史。
- 锁定证据：`scripts/sync-notes.test.mjs`、`fetch-depth: 0`、`quartz.config.yaml` 日期优先级和 `npm run build`。

## D-008 中文路由图谱必须使用 canonical slug

- 日期：2026-07-13
- 触发：用户发现 `Agent MCP 完全指南`明明关联了多篇笔记，局部关系图谱却只显示一个带 `%E5...` 标签的孤立点。
- 决策：图谱从浏览器 URL 取路径时必须先解码，再与 `contentIndex.json` 中的 canonical slug 匹配。异步渲染在读取索引后和 PIXI 初始化后都必须校验 render generation，过期渲染不能继续挂载或泄露 WebGL 上下文。兼容修复由仓库内本地组件接管，不手改 `.quartz/` 插件缓存。
- 反例：直接用 `window.location.pathname` 的百分号编码值扩展局部图，或在 `.quartz/plugins/graph` 里做一次性修改。
- 边界：外部 URL 不进入图谱；无内链且无反链的笔记可以合理地显示单点。
- 锁定证据：`quartz/components/GraphCompatibility.ts`、`GraphCompatibility.test.ts` 的 URL 与 render-generation 上游标记检查、单 worker 中文路由浏览器图谱矩阵和生产 `contentIndex.json` smoke。浏览器门禁不并行争抢 Chromium 共享 WebGL 上下文，但页面、视口与主题覆盖不能减少。

## D-009 图片预览交互使用成熟组件

- 日期：2026-07-13
- 触发：用户指出自研图片缩放容易产生交互和兼容性问题，要求确认并改用成熟组件。
- 决策：博客和笔记站统一固定使用 `PhotoSwipe 5.4.4`。仓库适配层只负责筛选文章图片、补充尺寸与语义、接入 Quartz SPA 生命周期和映射品牌令牌；缩放、拖拽、触控、图库导航、焦点圈定与焦点恢复由 PhotoSwipe 提供。PhotoSwipe 核心从本站版本化静态资源按第一次打开图片加载，不进入页面初始模块图。
- 反例：重新实现缩放比例、触摸手势、拖拽边界、焦点圈定或自制弹层工具栏，或者使用浮动版本导致交互在无人复核时改变。
- 边界：链接图片和图谱、Mermaid、Canvas、Excalidraw 等交互内容不接管；升级 PhotoSwipe 主版本前必须重新通过浏览器矩阵和无障碍检查。
- 锁定证据：精确依赖版本、`ImageLightbox.test.ts`、初始与总 JS 双预算、博客和笔记的 320/390/1440 浅深色浏览器用例、SPA 与同文图库导航用例。

## D-010 匿名点赞属于博客独立运行时

- 日期：2026-07-13；2026-07-14 交互纠偏
- 触发：用户要求在笔记或博客增加点赞功能，随后指出文末入口不符合真实阅读行为，并要求用图标替代廉价的可见状态文字、在点赞旁增加文章浏览量。
- 决策：博客和笔记正文共用一条紧凑的图标互动栏，并从正文首屏开始固定悬浮在视口右下安全区。可见界面固定为 Lucide `Eye + 浏览数` 和 `ThumbsUp + 点赞数`，不展示“赞”“已赞”“谢谢”等状态文案；语义和反馈保留在 `aria-label` 与读屏状态区。点赞和浏览按 `site + canonical slug` 独立；浏览量定义为同一匿名浏览器对同一文章只计一次。独立 `markz-reactions` 服务使用 SQLite 的 `reactions`、`views` 唯一键保证持久化与幂等；浏览器随机 ID 经 SHA-256 后保存，来源 IP 只在 Nginx 限流内存中短暂使用，不进入数据库。服务没有宿主机端口，也不复用 JSONUtils API 或数据库。
- 反例：只在 `localStorage` 伪造公共计数、把互动入口仅放在文章末尾、用可见文字堆叠状态、自绘通用图标、按刷新次数虚增浏览量、把接口塞进 JSONUtils、为匿名互动引入账号系统，或让数据库目录进入静态站 `rsync --delete` 范围。
- 边界：博客成稿与原始笔记是不同内容表面，默认不合并计数；清空浏览器存储后可再次计入点赞和浏览，当前不承诺账号级防刷或精确用户分析。首页、目录、标签、Canvas 和 Bases 页面不展示互动栏。
- 锁定证据：reactions API 的点赞与浏览幂等、并发、旧库迁移和持久化测试，Lucide 精确依赖，Compose 无公网端口契约，Nginx 精确路由与写限流测试，两站正文首屏图标栏、多视口双主题和 SPA 浏览器用例，以及生产健康、幂等写入与端口 smoke。Lucide 图标数据使同时包含博客与笔记回退产物的 blog 总 JS 上限从 485 KB 调整到 490 KB；200 KB 首屏上限与 notes 总量上限保持不变。

## D-011 移动端收起的笔记目录必须完全离开视口

- 日期：2026-07-14
- 触发：互动栏视觉检查和 390px 并发门禁反复发现笔记目录收起后仍在视口左侧泄露约 16px，既产生横向滚动，也露出残缺文字。
- 决策：移动端目录面板的绝对定位必须抵消页面 16px 安全边距；收起状态的右边界不得大于视口左边界 1px，打开状态仍覆盖完整视口。
- 反例：只隐藏溢出条、放宽横向滚动断言，或接受页面左边出现残缺目录文字。
- 锁定证据：notes 的 320px、390px 浅深色浏览器矩阵显式断言收起目录 `right <= 1px`，全页继续断言没有横向溢出。
