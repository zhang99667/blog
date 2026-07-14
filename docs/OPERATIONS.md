# MarkZ Operations

## 日常开发

```bash
npm ci
npx quartz plugin install
npm run sync
npm run check
npm test
npm run build
```

博客和笔记分别使用 `npm run preview`、`npm run preview:notes`。视觉改动还必须运行 `npm run quality:web`。

广义成熟度迭代先运行 `npm run evolve:report`。报告按 `ai/evolution.json` 的固定评分公式列出已具备能力、证据不足项和下一优先项；实现完成后运行 `npm run evolve:check` 和 `npm run evolve:report`，确认探针状态已改变。

`quality/link-baseline.json` 只记录迁移自 Obsidian 的历史断链债务。`quality:build` 会拒绝新增断链和已修复但未清理的陈旧基线；只有在人工确认债务变化后才运行 `node scripts/quality/check-build.mjs --update-link-baseline`。

本地调试互动 API 使用 `npm run reactions:serve`，默认数据库位于 `.cache/reactions-dev.sqlite`。Quartz 预览和 reactions 服务分别启动；生产页面只请求同源 `/api/reactions`、`/api/reactions/view` 和博客专属 `/api/visitors`。

## AI 演进巡检

`.github/workflows/markz-evolve.yaml` 每周一和相关控制面变更后运行。它安装锁定依赖，执行成熟度探针与代表性 eval，更新唯一的 `[AI Evolution] MarkZ maturity backlog` issue，并保存 Markdown/JSON 报告。

该工作流只做审计和排队，不提交代码、不触发部署、不读取生产 SSH 密钥。`critical` 路由、隐私、破坏性操作、外部密钥和任何证据不足的能力都必须由人工选择任务后走标准开发、验证和发布流程。若报告与仓库事实不符，先修探针或模型，不能手工改 issue 文案冒充能力完成。

发现与分发产物由构建生成：博客根 RSS 只包含 `/blog/<slug>` 成稿；两站 robots 指向各自 canonical sitemap；笔记回退页指向 `note.markz.fun` 并禁止索引。`npm run quality:build` 会校验这些契约及单一字体样式表。

## 发布流程

### 自动发布

`.github/workflows/markz-publish.yaml` 是生产发布入口。它响应 `main` push、每小时 cron、手动触发和 `notes-updated` repository dispatch，并依次：

1. 使用只读 deploy key 将私有 `zhang99667/note` 签出到 `.cache/note`。
2. 安装固定版本依赖和 Chromium。
3. 运行 `npm run deploy`，其中包含完整 `verify`、浏览器质量门禁和差量部署。
4. 运行 `npm run smoke:production`，检查所有域名、API 和端口所有权。
5. 保存浏览器报告 14 天。

部署会先同步 `services/reactions/`，启动并等待 `markz-reactions` 健康，再执行 Nginx 配置测试和 edge 重建。SQLite 位于 `/home/markz/apps/blog/reactions-data/reactions.sqlite`，不会被静态站差量同步删除。

### 互动数据维护

- 健康检查：`curl -fsS https://markz.fun/api/reactions/health`。
- 访客只读汇总：`curl -fsS https://markz.fun/api/visitors`；该请求不登记访客，可用于生产 smoke。
- 容器状态：`docker inspect -f '{{.State.Health.Status}}' markz-reactions`。
- 备份时先短暂停止 reactions，复制整个 `reactions-data` 目录后再启动，确保数据库、WAL 和共享内存文件属于同一时点。
- 不要使用 `docker compose down -v` 代替普通重建；虽然当前数据库是 bind mount，运维习惯仍应保护持久化目录。
- 恢复时保持目录属主为服务器 `markz` 用户，并在恢复后先检查健康接口，再重建 edge。

匿名点赞、文章浏览和博客访客只用于轻量反馈，不是账号级统计或风控。`reactions`、`views` 分别阻止同一浏览器 ID 对同一文章重复累计；`visitors` 阻止累计访客重复，`daily_visitors` 保存北京时间当天稳定序号。Nginx 对 POST 按来源地址做短期内存限流；服务不持久化来源 IP。清空浏览器存储后可以再次计入，这是当前产品边界。

访客功能首次启用时，会把已有博客文章点赞和唯一浏览中的匿名哈希合并进 `visitors`，作为累计基线；`daily_visitors` 从功能上线当天开始，不反推历史日序号。博客页面每次完整加载最多登记一次，Quartz 站内 SPA 跳转复用当前结果。接口失败时页脚计数隐藏，不能阻断静态内容。

GitHub 仓库需要以下 Actions 配置：

| 类型     | 名称                    | 用途                                |
| -------- | ----------------------- | ----------------------------------- |
| Secret   | `NOTE_REPO_SSH_KEY`     | `note` 仓库专用只读 deploy key 私钥 |
| Secret   | `MARKZ_SSH_PRIVATE_KEY` | CI 专用服务器部署私钥               |
| Variable | `BLOG_SSH_HOST`         | 可选，默认 `markz@39.97.237.248`    |

不要把个人日常 SSH 私钥上传到 GitHub。两把 CI 密钥独立生成、独立撤销；`note` deploy key 不授予写权限。

### 本地发布

1. 运行 `npm run deploy`。
2. 运行 `npm run smoke:production`。
3. 远端确认 `markz-edge` 独占 `80/443`，JSONUtils 容器端口绑定为空。

部署脚本同步 reactions 服务代码后必须使用 `--force-recreate --wait reactions` 重建进程，再校验 Nginx 并重建 edge。仅更新 bind mount 文件不会让已运行的 Node 进程加载新代码。

浏览器报告和截图保存在 `playwright-report/` 与 `test-results/`，CI 保留 14 天。上线结论必须来自完整矩阵，不能用单个页面或单一主题代替。

本地部署默认读取 `~/.ssh/id_ed25519`，也可通过 `BLOG_SSH_KEY` 和 `BLOG_SSH_HOST` 覆盖。密钥不进入仓库；禁止在文档、脚本和 CI 配置中写入私钥或 API key。

## 故障处理

### markz.fun 打开 JSONUtils

1. 检查 `docker inspect` 的宿主机端口绑定。
2. 如果 JSONUtils 绑定了 `80/443`，先修复其 Compose，再重建 `markz-edge`。
3. 检查 `deploy/nginx.conf` 的 `server_name` 与默认 server。
4. 对所有域名执行 HTTPS smoke，不以单个首页 `200` 作为恢复证据。

### note.markz.fun 返回 421

1. 检查证书是否包含 `note.markz.fun`。
2. 检查对应 TLS server block 是否存在。
3. 使用带 SNI 的 `curl` 验证，不用裸 IP 代替域名。

### 内容没有同步

1. 查看 `npm run sync` 的 source commit、copied 和 unchanged 汇总。
2. 检查公开标记、排除规则与 slug 冲突。
3. 检查 `.cache/publish-manifest.json`，不要手改生成 Markdown。
4. 在 GitHub Actions 中确认 `MarkZ Publish` 最近一次运行成功，私有 note 签出使用的是只读 deploy key。

### 新互动或访客接口返回 404

1. 先确认 `/api/reactions/health` 正常，区分边缘路由故障和旧服务进程。
2. 在远端执行 `docker compose up -d --force-recreate --wait reactions`，确保同步后的 `server.mjs` 被新 Node 进程加载。
3. 重新运行 `npm run smoke:production`，确认 `/api/visitors` 只读汇总和文章互动都可用；旧版本健康接口返回 200 不能证明新路由已加载。

### 笔记日期全部变成同步当天

1. 确认 `MarkZ Publish` 对 note 使用 `fetch-depth: 0`，同步器需要完整文件历史。
2. 检查生成 Markdown 是否包含稳定的 `created`、`modified` frontmatter。
3. 运行 `npm test`，日期回归用例必须证明 Git 日期不受 checkout `mtime` 影响。
4. 比较首页或归档列表与正文头部的 `<time datetime>` 日期部分，两处必须一致。
5. 不要把 Quartz 日期优先级改回仅 `filesystem`，也不要把公开默认日期从 `created` 改成 `modified`。

### 是否需要 note Action

- 每小时同步：不需要，blog 的 schedule 会主动读取 note。
- 手动立即同步：在 blog 仓库运行 `MarkZ Publish`。
- push 后立即同步：可选地在 note 仓库发送 `notes-updated` repository dispatch。该 Action 只做通知，不能持有服务器 SSH 私钥。

## 回退原则

- 优先重新部署最近一个已验证构建，不用 `git reset --hard` 清理工作区。
- 品牌图片使用版本化文件名，回退 HTML 时保留对应旧资产。
- 路由回退不能让 JSONUtils 接管公网端口。
- 每次事故都要补充 `docs/AI-DECISIONS.md` 和可执行检查。
