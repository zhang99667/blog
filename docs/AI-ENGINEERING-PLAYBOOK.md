# MarkZ AI Engineering Playbook

本文档让 Codex、Claude Code 和其他 coding agent 在本仓库里使用同一套上下文、设计规则和验证闭环。

## 必读顺序

1. `AGENTS.md`：项目边界、生成物和命令入口。
2. `ai/manifest.json`：权威图、路径指令、风险流程、命令和证据。
3. `docs/ARCHITECTURE.md`：系统边界与数据流。
4. `design-system/manifest.json`：各域名的角色与身份边界。
5. `docs/DESIGN-SYSTEM.md`：视觉原则与变更协议。
6. `docs/AI-DECISIONS.md`：用户纠偏和已锁定的架构决策。
7. 涉及成熟度巡检或自主迭代时读取 `ai/evolution.json` 并先运行 `npm run evolve:report`。
8. 与任务相关的路径级指令、源码、测试和部署配置。

不要默认读取整份 Obsidian 内容。先用 `rg` 定位任务相关文件。

## 仓库事实

- 博客和笔记由 Quartz 5 构建。
- `scripts/sync-notes.mjs` 从 Obsidian 仓库同步并生成公开内容。
- `content/notes/`、`content/site/`、`public/` 和 `public-notes/` 都包含生成内容。
- 品牌唯一来源是 `design-system/tokens.json`。
- 成熟度能力、证据探针、排序公式和自主化边界唯一来源是 `ai/evolution.json`。
- 公网 `80/443` 只属于独立 `markz-edge`，JSONUtils 前端不能绑定宿主机公网端口。

## 标准工作流

1. 运行 `git status --short --branch`，保护用户现有改动。
2. 明确改动属于内容、视觉、构建、同步还是部署。
3. 读取对应权威源，避免修改生成物。
4. 定义可观察的成功标准，包括页面、视口、主题和路由。
5. 做最小但完整的系统改动。
6. 运行与改动范围匹配的自动检查。
7. 涉及 UI 时运行浏览器质量门禁，覆盖 320、390、1440 三档宽度和双主题。
8. 涉及上线时部署后检查博客、笔记、JSONUtils、后台、装箱单和 API。
9. 用户纠偏或重复事故必须回写决策与自动门禁。
10. 广义“继续优化”任务先按演进报告选择一个有边界的能力，完成后重新运行报告，证明能力状态发生变化。

## 修改入口

| 需求                       | 修改入口                                                     | 不要修改                |
| -------------------------- | ------------------------------------------------------------ | ----------------------- |
| 品牌颜色、字体、圆角、宽度 | `design-system/tokens.json`                                  | 生成 SCSS、生成 TS      |
| 字标结构                   | `quartz/components/BrandMark.tsx`                            | 各页面复制 HTML         |
| 博客首页文案和结构         | `scripts/sync-notes.mjs`                                     | `content/site/index.md` |
| 笔记公开范围               | `scripts/sync-notes.mjs`、`scripts/blog.config.mjs`          | `public-notes/`         |
| 路由与 TLS                 | `deploy/nginx.conf`、edge Compose                            | JSONUtils override      |
| 安全响应头                 | `deploy/security-headers.inc`、`deploy/nginx.conf`           | 各 location 复制具体值  |
| 博客与笔记 CSP             | `deploy/nginx.conf` host map、CSP 兼容组件                   | 给工具域名套编辑站策略  |
| favicon、通用分享图        | 设计令牌和 `generate.mjs`                                    | 版本化 PNG              |
| 文章级分享图               | 设计令牌、文章 frontmatter、`article-social-images.mjs`      | `.cache/social-images/` |
| canonical、JSON-LD         | `quartz/components/seo.ts`、`Head.tsx`                       | 生成 HTML               |
| RSS、robots                | `scripts/build-site-extras.mjs`                              | `public/` 发现文件      |
| 文章继续阅读               | `scripts/sync-notes.mjs`                                     | 生成文章 Markdown       |
| 成熟度能力与排序           | `ai/evolution.json`、`scripts/ai/evolve.mjs`                 | GitHub issue 正文       |
| CI Action 版本与更新       | 工作流、`.github/dependabot.yml`、`run-evals.mjs`            | 浮动 Action 标签        |
| 运行时备份与恢复           | `services/reactions/`、`scripts/runtime-backup/`、备份工作流 | 明文 Artifact、在线库   |

## 验证矩阵

| 变更                           | 必须运行                                                            |
| ------------------------------ | ------------------------------------------------------------------- |
| 设计令牌、组件、SCSS、品牌资产 | `npm run design:check`、`npm test`、`npm run build`                 |
| AI 入口、规范、Skill、评测     | `npm run ai:check`、`npm test`                                      |
| 成熟度模型、探针、定时报告     | `npm run evolve:check`、`npm run evals:check`                       |
| GitHub Action 与依赖策略       | `npm run ai:check`、`npm run evals:check`、`npm test`               |
| 加密异地备份、密钥或恢复       | `npm run ai:check`、`npm run evals:check`、`npm test`、真实恢复演练 |
| 同步逻辑、内容选择             | `npm test`、`npm run build`                                         |
| 部署和 Nginx                   | `docker compose config`、`nginx -t`、公网 smoke                     |
| CSP、脚本或第三方运行时        | `npm run quality:build`、`npm run quality:web`、公网 smoke          |
| 上线前完整验证                 | `npm run verify`                                                    |

浏览器、生产和安全补充门禁：

| 目标                             | 命令                       |
| -------------------------------- | -------------------------- |
| 构建元数据、断链、资产和体积预算 | `npm run quality:build`    |
| 真实页面布局、主题和 WCAG        | `npm run quality:web`      |
| 代表性 AI 场景                   | `npm run evals:check`      |
| 高危依赖漏洞                     | `npm run security:check`   |
| 线上域名、品牌、API、端口所有权  | `npm run smoke:production` |

## 风险分级

- `low`：文案或不影响行为的说明，运行快速门禁。
- `medium`：视觉、组件、内容发布规则，增加构建和浏览器证据。
- `high`：跨站身份、同步公开范围、AI 权威图，运行完整门禁并复核影响面。
- `critical`：公网路由、TLS、端口、密钥和部署生命周期，必须有变更前状态、配置测试、全域名 smoke 和回退依据。

异地备份的脚本和默认关闭工作流可以自主改进；创建 identity、启用 Artifact、轮换 recipient 或把恢复文件放入生产必须先得到明确批准。源码中出现工作流不等于能力完成，`evolve:report` 还必须看见 public recipient，并由首次远端运行和下载恢复补足运行时证据。

任务风险与必需证据以 `ai/manifest.json` 为机器权威。风险不明确时按更高一级处理。

## 上下文分层

- 根入口只保存所有任务都需要的边界和命令。
- `.github/instructions/` 保存设计、内容和部署路径特有规则。
- `.github/prompts/` 保存可复用流程，不复制长期规则。
- `docs/ARCHITECTURE.md` 和 `docs/OPERATIONS.md` 保存事实与运行手册。
- 新增入口必须指向同一权威图，不能为单个 Agent 创建冲突事实。

## 视觉检查

- 使用真实构建页面，不用孤立 mock 代替。
- 检查 `320x800`、`390x844` 和 `1440x900`。
- 检查浅色和深色。
- 检查标题最长情况、按钮换行、导航滚动和焦点状态。
- favicon 和分享图使用版本化文件名，线上 HTML 必须引用当前版本。

## 规则进化

以下情况不能只修当前代码：

- 用户指出实现是一次性的，缺少系统化基础。
- 同一问题第二次出现。
- 自动检查没有覆盖已经发生的事故。
- AI 修改了生成物或越过站点身份边界。

处理方式：

1. 在 `docs/AI-DECISIONS.md` 记录触发、决策、反例、边界和验证。
2. 更新 `AGENTS.md`、项目 Skill 或设计规范中的权威入口。
3. 为可以确定判断的规则补脚本或测试。
4. 更新 `docs/AI-ASSET-REGISTRY.md`。
5. 为代表性场景补 `automatedChecks`，运行 `npm run evals:check`。
6. 运行 `npm run ai:check`，防止规则只停留在文档里。
7. 运行 `npm run evolve:report`，确认已完成能力从缺口队列移除，下一项由同一评分模型选出。

## 完成定义

只有以下条件同时成立才算完成：

- 权威源已更新，生成物由脚本产出。
- 自动检查与测试通过。
- 代表性 eval、构建质量、依赖安全和浏览器质量门禁通过。
- 要求覆盖的页面、视口和主题已视觉验证。
- 线上路由和产品边界未退化。
- 新的可复用经验已写回规则和门禁。
