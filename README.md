# MarkZ

[markz.fun](https://markz.fun) 与 [note.markz.fun](https://note.markz.fun) 的源码和发布系统。博客用于整理后的文章，笔记站用于公开的 Obsidian 笔记；JSONUtils 等工具保持独立域名和产品身份。

本仓库公开代码、设计系统、测试和部署编排。原始 Obsidian 仓库 `zhang99667/note` 保持私有，构建产物也不会提交到本仓库。

## 发布链路

```text
private note repository
  -> scripts/sync-notes.mjs
  -> content/site + content/notes (generated, ignored)
  -> Quartz
  -> canonical + JSON-LD + RSS + robots
  -> public + public-notes (generated, ignored)
  -> rsync + markz-edge
  -> markz.fun + note.markz.fun
```

`.github/workflows/markz-publish.yaml` 在以下场景运行完整构建、浏览器检查、部署和线上 smoke：

- `main` 更新；
- 每小时定时同步；
- 手动触发；
- 收到可选的 `notes-updated` repository dispatch。

定时同步不要求修改 `note` 仓库。发布工作流使用只读 deploy key 签出私有笔记，`sync-notes.mjs` 用 SHA-256 manifest 判断新增、变更和删除，部署再由 `rsync --delete` 传输差异。若以后需要“笔记 push 后立即发布”，可以在 `note` 中增加一个只发送 `repository_dispatch` 的小型 Action；服务器 SSH 密钥仍只属于本仓库。

## 本地开发

需要 Node.js 24、npm 10，以及私有笔记仓库的读取权限。

```bash
npm ci
npx quartz plugin install
npm run sync
npm run check
npm test
npm run build
```

运行博客与笔记预览：

```bash
npm run preview
npm run preview:notes
```

不具备私有笔记权限的外部贡献者仍可执行 `npm run check`、`npm test`、`npm run evals:check` 和 `npm run security:check`。完整构建与部署只在受信任的发布工作流中运行。

运行 `npm run evolve:report` 可以查看机器可读能力账本的当前成熟度和下一优先项。每周巡检只更新一个 GitHub 改进任务，不自动提交代码或部署。

## 项目约定

- 系统边界与数据流见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
- 开发、发布和故障处理见 [`docs/OPERATIONS.md`](docs/OPERATIONS.md)。
- 视觉权威来源是 [`design-system/tokens.json`](design-system/tokens.json)。
- 项目级 Codex Skill 位于 [`.codex/skills/markz-site-maintainer/`](.codex/skills/markz-site-maintainer/)。
- 生成目录没有人工编辑权，也不会进入 Git 历史。

## License

本项目使用 [MIT License](LICENSE.txt)。站点生成能力基于 [Quartz v5](https://github.com/jackyzha0/quartz)，Quartz 原始版权声明保留在许可证与上游源码中。
