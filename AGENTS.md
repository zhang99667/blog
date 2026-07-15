# MarkZ Site Agent Guide

本仓库同时构建个人博客和公开笔记。所有 AI 修改必须保护品牌一致性、内容生成链和独立公网入口。

## 必读文件

1. `docs/AI-ENGINEERING-PLAYBOOK.md`
2. `ai/manifest.json`：权威文件、路径指令、风险流程和证据要求。
3. `docs/ARCHITECTURE.md`：系统边界、数据流和所有权。
4. `design-system/manifest.json`
5. 涉及 UI 时读取 `docs/DESIGN-SYSTEM.md` 和 `docs/SYSTEM-BENCHMARKS.md`
6. 涉及历史纠偏或部署时读取 `docs/AI-DECISIONS.md` 和 `docs/OPERATIONS.md`
7. 涉及 AI 资产时读取 `docs/AI-ASSET-REGISTRY.md`
8. 涉及成熟度巡检或自主迭代时读取 `ai/evolution.json`，先运行 `npm run evolve:report`

## 不可破坏的边界

- `design-system/tokens.json` 是颜色、字体、圆角、主要宽度和品牌资产版本的唯一来源。
- 不手改 `quartz/brand.generated.ts`、`quartz/styles/_brand.generated.scss` 或品牌 PNG。
- 品牌入口使用 `quartz/components/BrandMark.tsx`，不复制字标 HTML。
- `content/notes/`、`content/site/`、`public/` 和 `public-notes/` 含生成内容；首页结构修改 `scripts/sync-notes.mjs`。
- 博客是成稿，笔记是工作台。不要把博客首页做成笔记树。
- JSONUtils 和装箱单保留独立产品身份。
- 公网 `80/443` 只属于 `markz-edge`；不要恢复 JSONUtils Compose 的宿主机端口。
- 用户已通过 D-022 明确不采纳异地 Artifact 备份：不创建或提交 age 私钥，不启用、不定时触发，也不再主动请求批准。只有用户以后明确反转该决定，才重新进入审批流程。
- 用户明确不采纳的能力必须保留原探针和分数、继续显示为未达成，但退出自动优先队列；不能删除、降分或伪装成完成。

## 标准流程

1. 先执行 `git status --short --branch`。
2. 用 `rg` 定位权威源和同类实现。
3. 写清页面、视口、主题和路由成功标准。
4. 修改权威源，运行生成命令。
5. 运行匹配范围的门禁。
6. UI 改动运行浏览器门禁，检查 320px、390px、桌面、浅色和深色。
7. 部署后检查所有域名和 JSONUtils API。
8. 用户纠偏或重复问题要更新决策、规则和自动检查。
9. 自主迭代按进化报告选择首个有证据的活跃缺口；完成后重跑报告，不能通过降分、削弱探针或把“明确不采纳”冒充“已完成”让项目“进步”。

## 命令

```bash
npm run design:generate
npm run design:check
npm run ai:check
npm run evals:check
npm run evolve:check
npm run evolve:report
npm run check
npm test
npm run build
npm run quality:build
npm run quality:web
npm run verify
```

上线使用 `npm run deploy`。该命令必须先通过完整 `verify` 和浏览器质量门禁；上线后运行 `npm run smoke:production`。

## 修改后汇报

- 列出权威源和生成物的变化。
- 列出实际运行的检查。
- 说明视觉检查覆盖的页面、视口和主题。
- 说明未覆盖风险，不能用一次 200 或单张截图代替完整证据。
