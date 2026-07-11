# MarkZ Site Claude Guide

执行任何修改前先读取 `AGENTS.md`。机器可读权威图位于 `ai/manifest.json`，跨工具流程位于 `docs/AI-ENGINEERING-PLAYBOOK.md`。

必须遵守：

- 视觉值只改 `design-system/tokens.json`。
- 视觉任务读取 `docs/DESIGN-SYSTEM.md` 和 `design-system/manifest.json`。
- 不手改生成主题、生成 SCSS、品牌 PNG 或公开构建目录。
- 博客首页模板改 `scripts/sync-notes.mjs`，不是生成后的 Markdown/HTML。
- JSONUtils 和装箱单保持独立产品身份。
- `markz-edge` 独占公网 `80/443`。
- 用户纠偏和重复事故写入 `docs/AI-DECISIONS.md`，并补自动门禁。

收尾至少运行：

```bash
npm run check
npm test
npm run build
npm run quality:web
```

准备上线时运行 `npm run deploy`。
