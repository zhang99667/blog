# MarkZ System Benchmarks

MarkZ 不复制任何单一产品的外观。对标的目标是吸收成熟系统的结构化能力，再形成适合个人博客、公开笔记和独立工具边界的方案。

## 视觉系统

| 参考                                                           | 采用的原则                                      | MarkZ 落点                                                         |
| -------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| [GitHub Primer](https://primer.style/product/getting-started/) | 分层令牌、语义命名、组件级无障碍、紧凑效率      | 基础令牌、语义变量、对比度计算、组件契约、浏览器无障碍门禁         |
| [Vercel Geist](https://vercel.com/geist/introduction)          | 字体、颜色、网格和图标形成一致基础              | MarkZ 字标、克制色彩、稳定内容宽度、版本化品牌资产                 |
| [GOV.UK Design System](https://design-system.service.gov.uk/)  | 移动优先、语义 HTML、渐进增强、持续可访问性验收 | 320px 起的响应式矩阵、语义主区、键盘滚动容器、WCAG 2.2 AA 自动检查 |

不采用：营销式大卡片、装饰渐变、过量动效、把博客和笔记强行合并成同一种页面密度。

## AI 工程系统

| 参考                                                                                                                                                    | 采用的原则                           | MarkZ 落点                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------- |
| [OpenAI AGENTS.md](https://developers.openai.com/codex/guides/agents-md)                                                                                | 从仓库到子目录的分层指令             | 根 `AGENTS.md` 加路径级指令                   |
| [OpenAI Evals](https://developers.openai.com/api/docs/guides/evals)                                                                                     | 代表性样本、明确判定标准、可重复运行 | 设计与路由场景语料、确定性 runner、结果账本   |
| [Anthropic project memory](https://docs.anthropic.com/zh-CN/docs/claude-code/memory)                                                                    | 项目事实、命令和架构模式进入共享记忆 | `CLAUDE.md` 薄入口指向同一权威图              |
| [GitHub Copilot customization](https://docs.github.com/en/copilot/how-tos/custom-instructions/adding-repository-custom-instructions-for-github-copilot) | 仓库级、路径级指令和可复用 prompt    | `.github/instructions/` 与 `.github/prompts/` |

## 完整度标准

- 每个规则都能追溯到一个权威文件。
- 每个高风险流程都有固定命令和证据要求。
- 每个发生过的故障都有决策记录和确定性门禁。
- 视觉验收覆盖博客/笔记、首页/正文、浅色/深色、320/390/1440 三个宽度。
- 自动检查输出可以进入 CI，不依赖某个 Agent 声称“已经看过”。

每季度或发生重大品牌、框架、Agent 平台变化时复核一次本表。新参考必须说明采用什么、不采用什么，避免无目的追随潮流。
