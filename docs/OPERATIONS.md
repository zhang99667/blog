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

广义成熟度迭代先运行 `npm run evolve:report`。报告按 `ai/evolution.json` 的固定评分公式列出已具备能力、活跃缺口、明确不采纳项和下一优先项；实现完成后运行 `npm run evolve:check` 和 `npm run evolve:report`，确认探针状态已改变。明确不采纳项保留失败证据但不进入自动队列。

`quality/link-baseline.json` 的公开断链债务必须保持为零。同步器只为本轮确认公开的笔记生成链接，私有或缺失目标降级成普通文字；`quality:build` 会拒绝任何新增断链。只有修复权威源并确认完整构建结果后，才运行 `node scripts/quality/check-build.mjs --update-link-baseline`，不能把新断链登记成“已知问题”绕过门禁。

本地调试互动 API 使用 `npm run reactions:serve`，默认数据库位于 `.cache/reactions-dev.sqlite`。Quartz 预览和 reactions 服务分别启动；生产页面只请求同源 `/api/reactions`、`/api/reactions/view` 和博客专属 `/api/visitors`。

## AI 演进巡检

`.github/workflows/markz-evolve.yaml` 每周一和相关控制面变更后运行。它安装锁定依赖，执行成熟度探针与代表性 eval，更新唯一的 `[AI Evolution] MarkZ maturity backlog` issue，并保存 Markdown/JSON 报告。

该工作流只做审计和排队，不提交代码、不触发部署、不读取生产 SSH 密钥。`critical` 路由、隐私、破坏性操作、外部密钥和任何证据不足的能力都必须由人工选择任务后走标准开发、验证和发布流程。若报告与仓库事实不符，先修探针或模型，不能手工改 issue 文案冒充能力完成。

发现与分发产物由构建生成：博客根 RSS 只包含 `/blog/<slug>` 成稿；两站 robots 指向各自 canonical sitemap；笔记回退页指向 `note.markz.fun` 并禁止索引。`npm run quality:build` 还会解析每个 HTML，拒绝可执行内联脚本、事件属性、JavaScript URL、未获策略许可的资源源站，以及 Mermaid/Explorer 运行时回退到外部执行。

## 发布流程

### 自动发布

`.github/workflows/markz-publish.yaml` 是生产发布入口。它响应 `main` push、每小时 cron、手动触发和 `notes-updated` repository dispatch，并依次：

1. 使用只读 deploy key 将私有 `zhang99667/note` 签出到 `.cache/note`。
2. 安装固定版本依赖和 Chromium。
3. 运行 `npm run deploy`，其中包含完整 `verify`、浏览器质量门禁和差量部署。
4. 运行 `npm run smoke:production`，检查所有域名、API 和端口所有权。
5. 保存浏览器报告 14 天。

部署会先同步 `services/reactions/`、同步器生成的 `.cache/reaction-aliases.json`、`nginx.conf` 和集中式 `security-headers.inc`。已有备份服务健康时，部署脚本先强制生成一份已验证在线快照，再重建并等待 `markz-reactions` 与 `markz-reactions-backup` 健康；新服务在启动事务中把旧路由计数合并到稳定 content ID，随后才执行 Nginx 配置测试和 edge 重建。SQLite 位于 `/home/markz/apps/blog/reactions-data/reactions.sqlite`，本机快照位于 `/home/markz/apps/blog/reactions-backups/`；两者都不会被静态站差量同步删除。生产 smoke 还会从最新快照恢复一个隔离数据库并校验表行数，检查页面、API、静态资源和 404 的安全响应头，并精确比较博客与笔记 CSP；独立工具只检查公共安全基线，不强行继承编辑站 CSP。

### 互动数据维护

- 健康检查：`curl -fsS https://markz.fun/api/reactions/health`。
- 访客只读汇总：`curl -fsS https://markz.fun/api/visitors`；该请求不登记访客，可用于生产 smoke。
- 容器状态：`docker inspect -f '{{.Name}} {{.State.Health.Status}}' markz-reactions markz-reactions-backup`。
- 备份健康：`docker exec markz-reactions-backup node /app/backup.mjs health`。
- 恢复演练：`docker exec markz-reactions-backup node /app/backup.mjs drill`。
- 立即生成一份在线快照：`docker exec markz-reactions-backup node /app/backup.mjs once`。不要直接复制正在使用 WAL 的 `.sqlite` 单文件。
- 自动策略固定为每 6 小时一次、最多 32 份；在线副本先转成不依赖 WAL/SHM 的 `DELETE` journal 单文件快照，再通过 SQLite `integrity_check`、`foreign_key_check`、SHA-256 和表行数清单，之后才能成为 `latest.json`。备份目录不得残留快照 sidecar 或 `.partial` 文件。
- 不要使用 `docker compose down -v` 代替普通重建；虽然当前数据库是 bind mount，运维习惯仍应保护持久化目录。
- 本机快照与数据库在同一服务器上，只是快速恢复层，不是异地灾备。未配置专用加密密钥前，禁止把含匿名哈希的明文 SQLite 上传到公开仓库或 Actions artifact。

恢复生产数据时先把快照恢复到新文件，不原地覆盖：

1. 运行 `backup.mjs verify /backups/<snapshot>.sqlite`，再运行 `backup.mjs restore /backups/<snapshot>.sqlite /backups/recovered.sqlite`。
2. 停止 `reactions` 与 `reactions-backup`，保留当前 `reactions.sqlite`、`-wal`、`-shm` 作为同一时点的回退副本。
3. 把已验证的 `recovered.sqlite` 安装到数据目录，权限设为 `0600`，属主保持服务器 `markz` 用户；不要把旧 WAL/SHM 配到新主文件。
4. 使用 `docker compose up -d --force-recreate --wait reactions reactions-backup` 重启，依次检查 API 健康、备份健康和恢复演练，再重建 edge。

### 用户已拒绝的异地备份（手动休眠）

D-022 记录用户明确认为异地 GitHub Artifact 备份没有必要。`.github/workflows/markz-backup.yaml` 因此没有定时触发，不创建专用密钥、不设置 `MARKZ_RUNTIME_BACKUP_ENABLED`、不上传外部 Artifact，也不再主动请求批准。本机每 6 小时的已验证快照继续运行，这是当前接受的恢复边界。

源码只保留手动、双重门控的恢复工具供未来选择；只有用户以后明确反转 D-022，才能执行以下激活步骤。工作流使用 `deploy/known_hosts` 固定生产 Ed25519 主机身份，不使用动态 `ssh-keyscan`：

1. 运行 `bash scripts/runtime-backup/bootstrap-key.sh --confirm-create-key`。默认把私钥写到仓库外的 `~/.config/markz/runtime-backup.agekey`，权限 `0600`；仓库只得到 `deploy/runtime-backup-recipient.txt` 公钥。
2. 把私钥另存到用户控制的密码管理器或离线介质。服务器、GitHub Secrets、Actions 日志和提交历史都不能保存它。
3. 提交公钥并运行完整门禁后，设置仓库变量：`gh variable set MARKZ_RUNTIME_BACKUP_ENABLED -R zhang99667/blog --body true`。
4. 手动触发首次运行：`gh workflow run markz-backup.yaml -R zhang99667/blog`，等待成功并确认 Artifact 只包含一个 `.age` 和一个 `.sha256`。
5. 下载首次 Artifact，按下述命令恢复到新文件；把 run、artifact ID、digest、source commit、recipient SHA-256 和恢复结论写入 `ai/runtime-backup-activation.json`。只有新的决策移除 declined disposition 且该证据与当前公钥匹配后，`runtime-backup` 才能标为完成。

激活证据格式固定为：

```json
{
  "version": "1.0.0",
  "activatedAt": "<ISO-8601 UTC>",
  "workflowRunId": 123456789,
  "artifactId": 123456789,
  "artifactName": "markz-runtime-backup-123456789",
  "artifactDigest": "sha256:<64 lowercase hex>",
  "sourceCommit": "<40 lowercase hex>",
  "recipientSha256": "<sha256 of deploy/runtime-backup-recipient.txt>",
  "retentionDays": 90,
  "restoreDrill": "passed"
}
```

该文件是未来明确反转 D-022 后的首次激活证据，不由任务自动提交。当前不应创建该文件；recipient 变化会让探针重新变为未完成，直到新旧 recipient 重叠轮换和下载恢复重新得到证明。

未来手动启用时，工作流读取最新本机快照并再次执行 health 与 drill；Runner 只在临时目录保存明文。`age 1.3.1` 发布包与平台 SHA-256 固定，实际密文同时写给长期公钥和本次运行的临时公钥。上传前必须用临时私钥解密同一密文、验证精确文件集并真实恢复 SQLite；随后清除 staging、临时私钥和恢复文件。Artifact 关闭二次压缩并保留 90 天。因为没有自动计划，不能声称具备固定异地 RPO。

下载并恢复异地副本：

```bash
gh run list -R zhang99667/blog --workflow markz-backup.yaml --status success
gh run download <run-id> -R zhang99667/blog --name markz-runtime-backup-<run-id> --dir .cache/runtime-backup-download
bash scripts/runtime-backup/restore-encrypted.sh \
  .cache/runtime-backup-download \
  ~/.config/markz/runtime-backup.agekey \
  .cache/recovered-reactions.sqlite
node services/reactions/backup.mjs verify .cache/recovered-reactions.sqlite
```

恢复脚本会先校验密文 SHA-256、通过 `age` 认证解密、检查包内只有快照和两份清单，再恢复到一个不存在的新路径。把该文件替换进生产仍属于破坏性操作，必须另行确认，并按上一节先停服务、保留当前数据库与 WAL/SHM 回退副本。

轮换密钥时先生成第二把专用 identity，将新旧两个公钥同时放入 recipient 文件并成功运行、下载、恢复一份新 Artifact；旧私钥至少保留到最后一份使用旧 recipient 的 Artifact 过期后才能删除。不要原地覆盖 identity，也不要只更新公钥而没有恢复证据。

匿名点赞、文章浏览和博客访客只用于轻量反馈，不是账号级统计或风控。`reactions`、`views` 分别阻止同一浏览器 ID 对同一文章重复累计；`visitors` 阻止累计访客重复，`daily_visitors` 保存北京时间当天稳定序号。Nginx 对 POST 按来源地址做短期内存限流；服务不持久化来源 IP。清空浏览器存储后可以再次计入，这是当前产品边界。

文章互动的持久身份不是 URL。每次同步生成 `.cache/reaction-aliases.json`，把博客与笔记公开路由映射到由源笔记相对路径派生的稳定 content ID；同一源笔记共享计数，标题、正文、frontmatter 或博客 slug 更新不会重置。服务启动会幂等迁移旧 `site + slug` 行并按匿名哈希去重。若源文件相对路径改名，必须保留或新增显式迁移 alias，并在上线前用最新快照演练；不要靠标题相似度自动合并。

访客功能首次启用时，会把已有博客文章点赞和唯一浏览中的匿名哈希合并进 `visitors`，作为累计基线；`daily_visitors` 从功能上线当天开始，不反推历史日序号。博客页面每次完整加载最多登记一次，Quartz 站内 SPA 跳转复用当前结果。接口失败时页脚计数隐藏，不能阻断静态内容。

GitHub 仓库需要以下 Actions 配置：

| 类型     | 名称                           | 用途                                |
| -------- | ------------------------------ | ----------------------------------- |
| Secret   | `NOTE_REPO_SSH_KEY`            | `note` 仓库专用只读 deploy key 私钥 |
| Secret   | `MARKZ_SSH_PRIVATE_KEY`        | CI 专用服务器部署私钥               |
| Variable | `BLOG_SSH_HOST`                | 可选，默认 `markz@39.97.237.248`    |
| Variable | `MARKZ_RUNTIME_BACKUP_ENABLED` | 休眠异地工具审批开关，当前不设置    |

不要把个人日常 SSH 私钥上传到 GitHub。两把 CI 密钥独立生成、独立撤销；`note` deploy key 不授予写权限。

生产 SSH 主机公钥固定在 `deploy/known_hosts`。服务器重装或主机密钥轮换时，应从已经信任的控制台核验新指纹后更新权威文件并跑完整发布门禁；不要通过恢复 `ssh-keyscan` 绕过失败。

### 本地发布

1. 运行 `npm run deploy`。
2. 运行 `npm run smoke:production`。
3. 远端确认 `markz-edge` 独占 `80/443`，JSONUtils 容器端口绑定为空。

部署脚本同步 reactions 服务代码与 `reaction-aliases.json` 后，必须先通过当前 backup 容器生成一份在线快照，再使用 `--force-recreate --wait reactions reactions-backup` 重建两个进程，最后校验 Nginx 并重建 edge。仅更新 bind mount 文件不会让已运行的 Node 进程加载新代码。

浏览器报告和截图保存在 `playwright-report/` 与 `test-results/`，CI 保留 14 天。上线结论必须来自完整矩阵，不能用单个页面或单一主题代替。

本地部署默认读取 `~/.ssh/id_ed25519`，也可通过 `BLOG_SSH_KEY` 和 `BLOG_SSH_HOST` 覆盖。密钥不进入仓库；禁止在文档、脚本和 CI 配置中写入私钥或 API key。

## 故障处理

### markz.fun 打开 JSONUtils

1. 检查 `docker inspect` 的宿主机端口绑定。
2. 如果 JSONUtils 绑定了 `80/443`，先修复其 Compose，再重建 `markz-edge`。
3. 检查 `deploy/nginx.conf` 的 `server_name` 与默认 server。
4. 读取真实 HTML 的 `<title>`、`application-name` 和页面身份标记；正文正确但标题仍是 JSONUtils 时，检查历史恢复与 SPA 标题校正，不能把标签缓存误判为路由已恢复。
5. 对所有域名执行 HTTPS smoke，精确比较博客、笔记、JSONUtils、后台和装箱单标题；不以单个首页 `200` 作为恢复证据。
6. 若站点标题和当前浏览器标签均正确，但书签栏仍显示旧名称，书签自定义标题属于浏览器本地数据，需要在浏览器中重命名；站点不能静默修改用户书签。

### 装箱单出现路径和子域双入口

1. 正式入口固定为 `https://zhangjihao.markz.fun/`，博客导航不得链接 `/zhangjihao/`。
2. `markz.fun/zhangjihao` 与其子路径只能返回保留后缀和查询参数的 `301`，不得出现 `alias`、`root` 或 `try_files` 静态托管。
3. 修改后运行路由 eval、远端 `nginx -t` 和生产 smoke，同时验证根路径与深层路径跳转；只检查首页最终为 `200` 会漏掉双入口。

### 首页或静态资源缺少安全响应头

1. 对首页、文章和静态资源分别运行 `curl -sSI`，不能用文章页的响应头代表全部 location。
2. 检查对应 location 是否声明了 `add_header`；Nginx 1.28 在当前层出现任意 `add_header` 时不会继承 server 层的其他响应头。
3. 不在各 location 复制四项具体值；确认 server 和该 location 都引用 `/etc/nginx/conf.d/security-headers.inc`。
4. 代理 API 若自行输出同名头，由集中 include 的 `proxy_hide_header` 统一收口；不要删除 Referrer map，它负责保留上游更严格策略。
5. 运行演进探针、远端 `nginx -t` 和完整生产 smoke，验证正常响应、静态资源与 404，并确认每项安全头只有一个有效值。

### 页面出现 CSP 拦截或功能空白

1. 在浏览器控制台读取 `securitypolicyviolation` 的 `effectiveDirective` 与 `blockedURI`，不要先加入 `unsafe-inline`、`unsafe-eval` 或通配源。
2. 运行 `npm run build` 和 `npm run quality:build`，确认最终 HTML 没有可执行内联脚本；JSON-LD 是允许的数据脚本，不能误删。
3. Mermaid 空白时确认请求指向 `/static/vendor/mermaid-tiny-11.16.0.esm.min.js`；图谱空白时确认 D3/Pixi 来自对应 notes 路径。不要恢复 cdnjs 或 jsDelivr。
4. Explorer 若需要自定义排序或过滤，先增加声明式选项和兼容测试；不要恢复序列化函数与 `new Function`。
5. CSP 值只在 `deploy/nginx.conf` host map 修改；`security-headers.inc` 只发射映射值。默认值必须为空，避免接管 JSONUtils 和装箱单策略。
6. 运行完整浏览器矩阵、远端 `nginx -t` 和生产 smoke；一次无报错刷新不能证明 SPA、404、图谱和双主题都合规。

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
2. 在远端执行 `docker compose up -d --force-recreate --wait reactions reactions-backup`，确保同步后的服务与备份代码被新 Node 进程加载。
3. 重新运行 `npm run smoke:production`，确认 `/api/visitors` 只读汇总和文章互动都可用；旧版本健康接口返回 200 不能证明新路由已加载。

### reactions-backup 不健康

1. 运行 `docker logs --tail 100 markz-reactions-backup`，区分源数据库不可读、快照校验失败、目录权限和过期快照。
2. 检查 `/home/markz/apps/blog/reactions-backups` 权限为 `0700`，快照与清单为 `0600`；不要通过放宽到全局可读解决权限问题。
3. 运行 `docker exec markz-reactions-backup node /app/backup.mjs once`；随后分别执行 `health` 和 `drill`。
4. 若校验失败，保留失败文件与日志用于分析，不手改 `latest.json` 冒充健康；从最近一份通过校验的快照恢复。
5. 若整台服务器或磁盘不可用，本机快照也会同时丢失。当前必须明确报告“无异地副本”，不能把本机 32 份保留描述成完整灾备。

### MarkZ Runtime Backup 手动运行或失败

1. D-022 生效期间没有定时运行是正确状态；不要手动触发、设置启用变量或为报告数字创建密钥。
2. 只有用户明确反转 D-022 后，手动 job 仍跳过时才检查仓库变量是否精确为 `true`，并确认主分支包含仅公钥的 `deploy/runtime-backup-recipient.txt`。
3. SSH 失败先比对可信控制台中的主机 Ed25519 指纹与 `deploy/known_hosts`；不要现场执行 `ssh-keyscan` 覆盖固定值。
4. age 下载失败或校验不符时保留失败，核验官方发布与三平台 SHA 后通过代码审查升级；不能跳过 checksum。
5. 打包失败时区分本机快照健康、精确文件集、临时接收者解密和 SQLite 恢复哪一步失败。任何一步失败都不能上传旧密文冒充新恢复点。
6. Artifact 下载后必须运行 `restore-encrypted.sh`。只看到工作流绿色或文件存在，不足以批准生产恢复。

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
