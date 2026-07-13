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

`quality/link-baseline.json` 只记录迁移自 Obsidian 的历史断链债务。`quality:build` 会拒绝新增断链和已修复但未清理的陈旧基线；只有在人工确认债务变化后才运行 `node scripts/quality/check-build.mjs --update-link-baseline`。

本地调试点赞 API 使用 `npm run reactions:serve`，默认数据库位于 `.cache/reactions-dev.sqlite`。Quartz 预览和 reactions 服务分别启动；生产页面只请求同源 `/api/reactions`。

## 发布流程

### 自动发布

`.github/workflows/markz-publish.yaml` 是生产发布入口。它响应 `main` push、每小时 cron、手动触发和 `notes-updated` repository dispatch，并依次：

1. 使用只读 deploy key 将私有 `zhang99667/note` 签出到 `.cache/note`。
2. 安装固定版本依赖和 Chromium。
3. 运行 `npm run deploy`，其中包含完整 `verify`、浏览器质量门禁和差量部署。
4. 运行 `npm run smoke:production`，检查所有域名、API 和端口所有权。
5. 保存浏览器报告 14 天。

部署会先同步 `services/reactions/`，启动并等待 `markz-reactions` 健康，再执行 Nginx 配置测试和 edge 重建。SQLite 位于 `/home/markz/apps/blog/reactions-data/reactions.sqlite`，不会被静态站差量同步删除。

### 点赞数据维护

- 健康检查：`curl -fsS https://markz.fun/api/reactions/health`。
- 容器状态：`docker inspect -f '{{.State.Health.Status}}' markz-reactions`。
- 备份时先短暂停止 reactions，复制整个 `reactions-data` 目录后再启动，确保数据库、WAL 和共享内存文件属于同一时点。
- 不要使用 `docker compose down -v` 代替普通重建；虽然当前数据库是 bind mount，运维习惯仍应保护持久化目录。
- 恢复时保持目录属主为服务器 `markz` 用户，并在恢复后先检查健康接口，再重建 edge。

匿名点赞只用于轻量反馈，不是账号级风控。唯一键阻止同一浏览器 ID 的重复写入，Nginx 对 POST 按来源地址做短期内存限流；服务不持久化来源 IP。清空浏览器存储后可以再次点赞，这是当前产品边界。

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

### 笔记日期全部变成同步当天

1. 确认 `MarkZ Publish` 对 note 使用 `fetch-depth: 0`，同步器需要完整文件历史。
2. 检查生成 Markdown 是否包含稳定的 `created`、`modified` frontmatter。
3. 运行 `npm test`，日期回归用例必须证明 Git 日期不受 checkout `mtime` 影响。
4. 不要把 Quartz 日期优先级改回仅 `filesystem`。

### 是否需要 note Action

- 每小时同步：不需要，blog 的 schedule 会主动读取 note。
- 手动立即同步：在 blog 仓库运行 `MarkZ Publish`。
- push 后立即同步：可选地在 note 仓库发送 `notes-updated` repository dispatch。该 Action 只做通知，不能持有服务器 SSH 私钥。

## 回退原则

- 优先重新部署最近一个已验证构建，不用 `git reset --hard` 清理工作区。
- 品牌图片使用版本化文件名，回退 HTML 时保留对应旧资产。
- 路由回退不能让 JSONUtils 接管公网端口。
- 每次事故都要补充 `docs/AI-DECISIONS.md` 和可执行检查。
