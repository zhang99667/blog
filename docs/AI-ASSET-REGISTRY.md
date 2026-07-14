# MarkZ AI Asset Registry

AI 协作资产必须在这里登记，避免规则、Skill、评测和门禁成为无人维护的孤立文件。

| 资产                                           | 职责                           | 权威或生成 | 验证                                | 最近复核   |
| ---------------------------------------------- | ------------------------------ | ---------- | ----------------------------------- | ---------- |
| `AGENTS.md`                                    | Codex 和通用 coding agent 入口 | 权威       | `npm run ai:check`                  | 2026-07-10 |
| `CLAUDE.md`                                    | Claude Code 薄入口             | 权威       | `npm run ai:check`                  | 2026-07-10 |
| `GEMINI.md`                                    | Gemini 与兼容 Agent 薄入口     | 权威       | `npm run ai:check`                  | 2026-07-11 |
| `ai/`                                          | 机器可读权威、流程与评测清单   | 权威       | `npm run ai:check`                  | 2026-07-11 |
| `ai/evolution.json`                            | 成熟度能力、探针与优先级模型   | 权威       | `npm run evolve:check`              | 2026-07-14 |
| `ai/evolution.schema.json`                     | 进化模型机器契约               | 权威       | `npm run evolve:check`              | 2026-07-14 |
| `.codex/README.md`                             | 项目 Codex 资产说明            | 权威       | `npm run ai:check`                  | 2026-07-10 |
| `.codex/skills/markz-site-maintainer/SKILL.md` | 项目维护工作流                 | 权威       | skill validator、`npm run ai:check` | 2026-07-14 |
| `.github/copilot-instructions.md`              | Copilot 薄入口                 | 权威       | `npm run ai:check`                  | 2026-07-10 |
| `.github/instructions/`                        | 路径级设计、内容和部署规则     | 权威       | `npm run ai:check`                  | 2026-07-11 |
| `.github/prompts/`                             | 可复用任务流程                 | 权威       | `npm run ai:check`                  | 2026-07-11 |
| `.github/pull_request_template.md`             | 证据与 AI 来源审查模板         | 权威       | `npm run ai:check`                  | 2026-07-11 |
| `.github/dependabot.yml`                       | npm 与 CI Action 依赖更新策略  | 权威       | `npm run evals:check`               | 2026-07-14 |
| `deploy/security-headers.inc`                  | edge 安全响应头单一权威        | 权威       | `npm run evals:check`               | 2026-07-14 |
| `.github/workflows/markz-verify.yaml`          | 公开源码静态门禁               | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `.github/workflows/markz-publish.yaml`         | 私有内容同步与生产发布         | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `.github/workflows/markz-evolve.yaml`          | 定时刷新唯一成熟度改进任务     | 权威       | `npm run evolve:check`              | 2026-07-14 |
| `docs/AI-ENGINEERING-PLAYBOOK.md`              | 跨 AI 工具执行闭环             | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `docs/ARCHITECTURE.md`                         | 系统边界、数据流和所有权       | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `docs/OPERATIONS.md`                           | 发布、故障和回退手册           | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `docs/SYSTEM-BENCHMARKS.md`                    | 顶尖系统对标与取舍             | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `docs/AI-DECISIONS.md`                         | 用户纠偏和架构决策             | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `docs/DESIGN-SYSTEM.md`                        | 人类和 AI 共用视觉规范         | 权威       | `npm run design:check`              | 2026-07-11 |
| `design-system/tokens.json`                    | 设计令牌唯一来源               | 权威       | `npm run design:check`              | 2026-07-11 |
| `design-system/manifest.json`                  | 站点身份与验收矩阵             | 权威       | `npm run design:check`              | 2026-07-11 |
| `design-system/reference/markz-wordmark.png`   | 用户确认的视觉参考             | 权威参考   | 人工视觉检查                        | 2026-07-10 |
| `quartz/brand.generated.ts`                    | 运行时品牌与主题               | 生成       | `npm run design:check`              | 2026-07-11 |
| `quartz/styles/_brand.generated.scss`          | CSS 语义令牌                   | 生成       | `npm run design:check`              | 2026-07-11 |
| `scripts/design-system/`                       | 设计生成和漂移门禁             | 权威       | `npm test`                          | 2026-07-11 |
| `scripts/ai/`                                  | AI 资产治理门禁                | 权威       | `npm test`                          | 2026-07-14 |
| `scripts/ai/evolve.mjs`                        | 探测、评分和生成实时进化报告   | 权威       | `npm run evolve:check`、`npm test`  | 2026-07-14 |
| `quality/`                                     | 构建质量与性能预算             | 权威       | `npm run quality:build`             | 2026-07-11 |
| `scripts/quality/`                             | 构建、浏览器和生产 smoke 工具  | 权威       | `npm test`                          | 2026-07-11 |
| `playwright.config.ts`                         | 浏览器质量运行配置             | 权威       | `npm run quality:web`               | 2026-07-11 |
| `tests/quality/`                               | 布局、主题和 WCAG 真实页面门禁 | 权威       | `npm run quality:web`               | 2026-07-11 |
| `evals/design-system/cases.json`               | 代表性 AI 迭代场景             | 权威       | `npm run ai:check`                  | 2026-07-14 |
| `evals/design-system/outcomes.jsonl`           | 真实执行结果账本               | 追加式证据 | `npm run ai:check`                  | 2026-07-10 |

新增、移动或删除 AI 协作资产时，必须同步更新本表和治理脚本。
