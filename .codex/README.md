# Codex Project Assets

根目录 `AGENTS.md` 是 Codex 首读入口。

项目 Skill：

- `.codex/skills/markz-site-maintainer/SKILL.md`：维护博客、公开笔记、设计系统、同步和部署时使用。

权威资料：

- `docs/AI-ENGINEERING-PLAYBOOK.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/AI-DECISIONS.md`
- `docs/AI-ASSET-REGISTRY.md`
- `ai/evolution.json`：成熟度能力、证据探针、优先级与自主化边界。

项目 Skill 是可迁移资产；仓库规则仍以 `AGENTS.md` 和上述文档为准。修改本目录后运行 `npm run ai:check`；成熟度迭代同时运行 `npm run evolve:check`。
