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
