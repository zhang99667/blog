# MarkZ Architecture

本文档回答三个问题：内容从哪里来、页面如何生成、谁拥有公网入口。实现细节变化时，先更新这里和 `ai/manifest.json`，再更新 AI 指令。

## 系统边界

| 系统            | 职责                                 | 权威入口                            | 生成结果                          |
| --------------- | ------------------------------------ | ----------------------------------- | --------------------------------- |
| Obsidian 源仓库 | 私有写作与公开标记                   | `zhang99667/note`                   | 同步输入                          |
| 发布编排        | 定时触发、私有签出、校验与部署       | `markz-publish.yaml`                | 可审计的发布记录                  |
| 内容同步        | 筛选、复制、生成首页和文章元数据     | `scripts/sync-notes.mjs`            | `content/site/`、`content/notes/` |
| 设计系统        | 品牌、主题、排版、布局和无障碍基础   | `design-system/tokens.json`         | TS、SCSS、favicon、分享图规则     |
| Quartz 构建     | 博客、笔记和回退路由                 | `quartz.ts`、`quartz.config.yaml`   | `public/`、`public-notes/`        |
| 发现与分发      | canonical、结构化数据、RSS、robots   | `Head.tsx`、`build-site-extras.mjs` | HTML 元数据与站点发现文件         |
| 匿名互动与访问  | 文章点赞、唯一浏览、站点访客与持久化 | `services/reactions/`               | SQLite 数据文件                   |
| 运行时本机备份  | 在线一致快照、校验、保留与恢复演练   | `services/reactions/backup.mjs`     | 加密前的本机私有快照              |
| 异地恢复层      | 用户不采纳后的手动休眠恢复工具       | `markz-backup.yaml`、备份工具       | 当前不生成外部 Artifact           |
| AI 演进控制面   | 能力盘点、证据探针、处置和定时报告   | `ai/evolution.json`                 | 报告与唯一 GitHub 改进任务        |
| CI 供应链       | Action 不可变引用、运行时与依赖更新  | 工作流、`.github/dependabot.yml`    | 可审计的验证与发布运行            |
| 边缘安全策略    | HTTPS 响应头的一致性与继承边界       | `deploy/security-headers.inc`       | 页面、API、静态资源和错误响应     |
| 可执行内容策略  | 博客与笔记的脚本、样式和资源源站边界 | `deploy/nginx.conf` 的 CSP host map | 域名级 Content Security Policy    |
| 边缘路由        | TLS、域名分流和 API 代理             | `deploy/nginx.conf`                 | `markz-edge`                      |
| 独立工具        | JSONUtils、装箱单                    | 各自仓库                            | 独立产品界面                      |

## 数据流

```text
private zhang99667/note
  -> blog repository GitHub Action
  -> sync-notes.mjs
  -> content/site + content/notes + content-addressed article social cards
  -> Quartz builds
  -> canonical + JSON-LD + RSS + robots
  -> public + public-notes
  -> deploy.mjs
  -> markz-edge
  -> markz.fun / note.markz.fun
```

文章互动走独立的运行时链路：

```text
article-reactions component
  -> same-origin /api/reactions + /api/reactions/view
  -> markz-edge write rate limit
  -> markz-reactions
  -> generated route aliases resolve blog/note URLs to one stable source-content ID
  -> startup migration merges legacy route-keyed rows transactionally
  -> SQLite reactions.sqlite
```

博客页脚访客统计复用同一条隐私边界清晰的运行时链路：

```text
blog visitor counter
  -> same-origin /api/visitors
  -> markz-edge write rate limit
  -> markz-reactions
  -> SQLite visitors + daily_visitors
```

互动数据库的本机恢复链路独立于请求服务：

```text
live reactions.sqlite (WAL remains writable by markz-reactions)
  -> markz-reactions-backup reads /data read-only
  -> Node SQLite online backup API
  -> standalone DELETE-journal snapshot (no WAL/SHM dependency)
  -> integrity_check + foreign_key_check + SHA-256 + row-count manifest
  -> /home/markz/apps/blog/reactions-backups (0600 files, 0700 directory)
  -> 32 snapshots / roughly 8 days at a 6-hour interval
  -> production restore drill into an isolated temporary database
```

异地链路在源码中仅作为手动、双重门控的休眠工具保留：

```text
latest verified local snapshot + companion manifest
  -> pinned SSH host identity
  -> isolated GitHub-hosted runner staging
  -> exact three-file bundle verification
  -> pinned age release + dedicated public recipient + ephemeral test recipient
  -> decrypt round trip + isolated SQLite restore
  -> plaintext and ephemeral identity removal
  -> .age ciphertext + SHA-256 only
  -> GitHub Actions Artifact / manual dispatch only / 90-day retention
```

D-022 记录用户明确认为这条异地 Artifact 链路没有必要，因此工作流没有定时触发，也不创建 recipient、identity 或激活证据。`runtime-backup` 仍由原探针判定为未达成并保留原评分，但其 disposition 为 `declined`，不进入自动改进队列。只有用户以后明确反转 D-022，才允许手动 dispatch 且仍需 `MARKZ_RUNTIME_BACKUP_ENABLED == 'true'` 与 public recipient 双重门控。私钥只能位于用户控制的仓库外位置，不能进入生产服务器、GitHub Secret、日志或提交历史。本机快照仍只覆盖误操作、坏快照和数据库级恢复，不能宣称已覆盖整台服务器或磁盘丢失。

设计数据走单独的生成链：

```text
tokens.json
  -> generate.mjs
  -> brand.generated.ts + _brand.generated.scss + PNG assets
  -> blog + notes builds

tokens.json + pinned Noto Sans SC WOFF + synchronized article frontmatter
  -> article-social-images.mjs
  -> .cache/social-images/social/articles/<slug>-<hash>.png
  -> blog /static/social/articles/
  -> Open Graph + Twitter + BlogPosting image
```

成熟度演进走一条只读审计优先的控制链：

```text
ai/evolution.json
  -> deterministic source probes + eval cases
  -> achieved / active gap / explicitly declined disposition
  -> Markdown / JSON maturity report
  -> one scheduled GitHub backlog issue
  -> bounded human-reviewed implementation
  -> verify + browser gates + production smoke
```

CI Action 依赖使用独立的可审计生命周期：

```text
official GitHub Action release
  -> verified full commit SHA + exact version comment in workflow
  -> Dependabot checks github-actions at least weekly
  -> deterministic YAML probe rejects floating refs and retired majors
  -> Verify / Publish / Evolution / approval-gated Backup prove pinned revisions on GitHub-hosted runners
```

边缘安全响应头使用单一挂载文件，避免 Nginx location 继承陷阱：

```text
deploy/security-headers.inc
  -> deploy.mjs syncs the authority beside nginx.conf
  -> edge Compose mounts the read-only include
  -> every TLS server includes the baseline
  -> every location with its own add_header includes the same baseline again
  -> production smoke checks pages + APIs + static assets + 404 responses
```

博客与笔记的可执行资源还经过独立的域名级策略链：

```text
deploy/nginx.conf CSP host map (one policy literal)
  -> markz.fun + www.markz.fun + note.markz.fun
  -> security-headers.inc emits the mapped value
  -> default empty value leaves JSONUtils and packing-list CSP ownership untouched
  -> quality:build rejects inline execution and ungoverned resource origins
  -> local quality server applies the production policy
  -> every Playwright case rejects securitypolicyviolation
  -> production smoke exact-matches the deployed header
```

## 运行时路由

- `markz.fun`：博客静态文件；`/notes/` 是笔记回退入口。
- `note.markz.fun`：独立笔记静态文件。
- `markz.fun/api/reactions`、`note.markz.fun/api/reactions`：同一个匿名互动服务。公开路由先通过同步器生成的 alias 映射到稳定 source-content ID，再计算点赞和唯一浏览；同一源笔记的博客成稿与公开笔记共享计数，路由、标题、正文或 frontmatter 更新不改变身份。`/api/reactions/view` 幂等登记当前浏览器的文章浏览。
- `markz.fun/api/visitors`：博客专属站点访客接口；`GET` 只读返回北京时间当天与累计访客数，`POST` 为匿名浏览器登记稳定的当天序号。笔记和工具域名不暴露该接口。
- `jsonutils.markz.fun`：JSONUtils 前端与 `/api/` 代理；`/admin` 进入后台。
- `zhangjihao.markz.fun`：装箱单产品。
- `markz.fun/zhangjihao` 与其子路径：只保留到 `zhangjihao.markz.fun` 的永久兼容跳转，不直接读取装箱单静态卷。
- 只有 `markz-edge` 可以绑定宿主机 `80/443`。
- `markz-reactions` 只加入 edge 内部网络，不发布宿主机端口，也不加入 JSONUtils 网络。
- `markz-reactions-backup` 不加入任何 Docker 网络，只读挂载运行时数据库目录；它只能写独立备份目录，也不发布宿主机端口。
- `MarkZ Runtime Backup` 默认由仓库变量关闭；启用后只通过固定 SSH 主机身份读取已验证快照，不修改在线数据库，也不持有解密身份。

## 所有权规则

- 公开源码归 `zhang99667/blog`；原始笔记归私有 `zhang99667/note`。
- `content/site/`、`content/notes/`、`public/` 和 `public-notes/` 都是生成目录，不进入公开仓库。
- 定时发布和服务器密钥归 blog；note 最多发送更新通知，不拥有构建或部署职责。
- 品牌值归 `design-system/tokens.json`。
- 页面结构归 Quartz 组件或 `scripts/sync-notes.mjs` 模板。
- 页面标题、应用名和社交元数据归 `quartz/components/Head.tsx`；SPA 只按标题元素保存的独立权威值恢复浏览器标题，不能从旧工具状态或可变正文猜测。canonical 和 JSON-LD 归 `quartz/components/seo.ts`；RSS 与 robots 归 `scripts/build-site-extras.mjs`。笔记回退页 canonical 指向 `note.markz.fun` 并保持 `noindex`。
- 文章分享图的视觉值归设计令牌，标题、日期和分类归同步后的文章 frontmatter；`article-social-images.mjs` 负责内容寻址和渲染，Static emitter 只向博客产物发射。通用页面和笔记继续使用版本化品牌卡片。
- 文章末尾的“继续阅读”归同步器：只从博客成稿中按显式链接、反向引用、共同标签和同集合排序，最多三篇；不把仅笔记内容混入博客推荐。
- 长文回顶与文章互动栏共用 `ArticleReactions` 的 SPA 生命周期和正文边缘定位；回顶是纯前端阅读辅助，不访问互动 API，短文与目录页不挂载可见入口。
- 成熟度能力、评分、用户处置和风险边界归 `ai/evolution.json`；探针只报告可观察事实，明确不采纳项保持未达成但退出排序，定时工作流不能直接修改代码、部署或处理密钥。
- 远程 GitHub Actions 必须固定到完整 commit SHA，并在同行保留精确版本注释；`.github/dependabot.yml` 负责持续提出更新，探针负责拒绝浮动标签和已淘汰运行时主版本。
- HSTS、`nosniff`、防嵌入和 Referrer 策略归 `deploy/security-headers.inc`；`nginx.conf` 只负责在 TLS server 和缓存 location 引用，不复制具体值。生产 smoke 必须验证真实响应头而不只检查配置文本。
- 博客与笔记 CSP 的唯一策略值归 `deploy/nginx.conf` 中的 `$markz_content_security_policy` host map；`security-headers.inc` 只负责统一发射。默认映射必须为空，不能隐藏或覆盖 JSONUtils、后台和装箱单自行提供的 CSP。
- 生成目录没有编辑权。
- 路由归 edge 配置，工具 Compose 不能接管公网端口。
- 点赞、文章浏览和博客访客数据归 blog 系统；文章身份 alias 归 `sync-notes.mjs` 生成的 `.cache/reaction-aliases.json`，运行时只消费该清单并在启动事务中迁移旧 route key。服务端只保存浏览器随机 ID 的 SHA-256，不保存 IP。访客日界线固定为 `Asia/Shanghai`，同一浏览器当天和累计各计一次。数据库目录不参与静态文件 `rsync --delete`。
- 运行时快照归 `backup.mjs`；Compose 只规定本机调度与隔离，生产 smoke 必须验证最新快照并完成一次真实恢复。异地复制不得上传明文数据库，也不得复用个人 SSH 私钥充当加密密钥。
- 异地备份编排归 `markz-backup.yaml`，格式校验与恢复归 `offsite-backup.mjs` 和 `scripts/runtime-backup/`。专用 age 私钥归用户且必须位于仓库、服务器和 Actions 之外；仓库只允许公钥 recipient。启用变量、密钥创建、recipient 轮换和生产替换都需要明确批准。
- 用户纠偏归 `docs/AI-DECISIONS.md`，可判定规则必须进入自动门禁。
- 第三方组件的兼容修复归本仓库源码和浏览器门禁，不能依赖 `.quartz/` 插件缓存中的手工改动。

## 自动同步

`markz-publish.yaml` 在 `main` 更新、每小时定时、手动触发或收到 `notes-updated` dispatch 时运行。它使用只读 deploy key 将私有 note 仓库签出到 `.cache/note`，然后执行仓库内唯一的同步实现。

同步分两层增量：

1. `sync-notes.mjs` 对输出计算 SHA-256，仅重写变化文件，并删除源端已移除的公开文件。
2. 同步器从源笔记相对路径派生版本化稳定内容 ID，并生成博客与笔记公开路由 alias；标题、正文、frontmatter 和博客 slug 变化不改变该 ID。
3. `deploy.mjs` 使用 `rsync --delete`，只向服务器传输文件差异并清理过期产物；互动服务重启前先生成一份已验证在线快照，再加载 alias 并迁移旧路由计数。

笔记站在私有仓库签出完成后自动发现 Vault 的一级内容目录，不为每个新分类维护代码白名单。隐藏目录、工具目录以及 `Tasks`、`promotion docs` 等显式排除目录不进入发布集合；Markdown 只有明确声明 `publish: true` 才公开。在已经公开的 Markdown 中，只有精确声明 `type: post` 才进入博客成稿层；`type: note` 或缺少 `type` 只进入笔记站。`blog.config.mjs` 只为已经是 post 的内容补充稳定 slug、标题、摘要、精选状态和排序，不能强制改变内容表面。已知中文分类可以保留稳定的公网 slug，其他分类从目录名确定 slug；归一化后发生冲突时同步必须失败，不能把两个目录静默合并。文件或目录改名会生成新路径，并由 manifest 与 `rsync --delete` 清理旧路径；这不等于自动建立旧 URL 重定向。`BLOG_INCLUDE_DIRS` 只作为需要收窄范围时的显式覆盖。

公开日期的权威顺序是源笔记 frontmatter、note 仓库文件 Git 历史。对博客成稿，`date` 是唯一首选发布日期，`created`、`createdAt` 只作兼容回退，再回退到 Git 首次提交。同步器把这一解析结果统一供给列表、正文头部、RSS、文章分享图和 SEO，并把稳定的 `created`、`modified` 写入生成 Markdown；checkout 时间和生成文件 `mtime` 不能成为公开日期。`modified`、`updated`、`updatedAt` 保留用于更新元数据，不能悄悄替换公开显示日期。

公开链接使用两阶段生成：第一阶段先确定全部可公开记录，第二阶段才重写正文。目标已公开时输出带完整公开路径的 Quartz 双链，保留关系图谱和回链；目标私有、被过滤或不存在时只保留可读标题，不生成假链接。代码块、外部 URL 和真实公开资产不参与降级。

关系图谱继续使用上游 D3 + Pixi 渲染器，但运行时由项目锁定版本并在构建期裁剪成两个本域静态文件。`notes` 从 `/static/vendor/` 加载，`notes-fallback` 根据 `data-basepath` 从 `/notes/static/vendor/` 加载；没有图谱布局的博客构建不发射也不执行这段运行时。构建质量门禁拒绝重新出现 jsDelivr 依赖，并要求两个入口的资产与加载器同时存在。

Quartz 的内容索引和 404 恢复脚本由外部 `prescript`、组件资源承载，不再写进每页 HTML。Explorer 只接受项目已验证的声明式默认排序，运行时移除函数反序列化；自定义回调在有 CSP 安全实现前直接失败。Mermaid 11.16.0 的固定 Tiny 发行包在构建期转换成本站 ESM 并只在图表页按需加载；Pixi 使用官方 CSP 兼容模块替换动态函数生成。200 KB 核心脚本预算不因这些按需运行时放宽，完整自托管文件仍计入总 JS 预算。

博客成稿同步时同时生成静态“继续阅读”。关系计算只读取同一次同步中的公开记录，不请求外部推荐服务，也不在浏览器端重排，因此构建可复现、链接可检查、无额外隐私数据。

同一次同步还为每篇博客成稿写入 `socialImage` frontmatter，并从设计令牌、文章标题、编辑日期、分类、固定渲染器版本和字体校验和计算 URL。生成器只重画哈希变化的图片并删除陈旧文件；字体是仓库内固定的构建输入，不依赖操作系统或远程字体服务，也不发送给浏览器。构建门禁逐篇验证 1200x630 PNG、唯一 URL、字节预算以及 Open Graph、Twitter、JSON-LD 一致性。

生成内容虽然被 Git 忽略，项目构建脚本会显式设置 `QUARTZ_INCLUDE_GITIGNORED=1` 让 Quartz 读取它们；Quartz 的默认 gitignore 行为保持不变。构建和质量门禁每次从受控输入重新执行，避免复用不完整的远端状态。周期同步不需要 note Action；若需要推送后即时发布，note Action 只负责调用 blog 的 `repository_dispatch`，不接触服务器。

## 变更影响面

| 变更        | 最小影响面                   | 必须扩大的验证                                   |
| ----------- | ---------------------------- | ------------------------------------------------ |
| 设计令牌    | 博客、笔记、品牌图片         | 主题、三个视口、无障碍                           |
| 同步筛选    | 内容目录、索引、链接         | 公开范围、构建、断链                             |
| Quartz 组件 | 对应 frame 或页面类型        | 真实构建页面、SPA 导航                           |
| 发现元数据  | 博客、笔记、回退入口         | canonical、JSON-LD、RSS、robots、断链            |
| 文章分享图  | 博客成稿与社交元数据         | 字体校验和、尺寸、体积、唯一性、三处 URL         |
| 演进模型    | AI 报告、CI 和改进队列       | schema、探针、eval、风险边界                     |
| CI Action   | 验证、发布、演进与备份工作流 | 完整 SHA、版本注释、Dependabot、全部远端运行     |
| 运行时灾备  | 本机快照、异地密文与密钥     | 审批、完整性、加解密、恢复、保留和远端运行       |
| 安全响应头  | 所有 edge 域名与响应类型     | Nginx 上下文、Compose 挂载、2xx/404 生产 smoke   |
| CSP         | 博客、笔记和动态运行时       | HTML 解析、资源源站、52 场景违规监听、生产精确值 |
| edge 配置   | 所有公网域名                 | Nginx 测试、端口所有权、生产 smoke               |
| AI 规则     | Agent 行为与 CI              | manifest、eval runner、资产注册表                |
