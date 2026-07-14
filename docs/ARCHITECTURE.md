# MarkZ Architecture

本文档回答三个问题：内容从哪里来、页面如何生成、谁拥有公网入口。实现细节变化时，先更新这里和 `ai/manifest.json`，再更新 AI 指令。

## 系统边界

| 系统            | 职责                               | 权威入口                          | 生成结果                          |
| --------------- | ---------------------------------- | --------------------------------- | --------------------------------- |
| Obsidian 源仓库 | 私有写作与公开标记                 | `zhang99667/note`                 | 同步输入                          |
| 发布编排        | 定时触发、私有签出、校验与部署     | `markz-publish.yaml`              | 可审计的发布记录                  |
| 内容同步        | 筛选、复制、生成首页和文章元数据   | `scripts/sync-notes.mjs`          | `content/site/`、`content/notes/` |
| 设计系统        | 品牌、主题、排版、布局和无障碍基础 | `design-system/tokens.json`       | TS、SCSS、favicon、分享图         |
| Quartz 构建     | 博客、笔记和回退路由               | `quartz.ts`、`quartz.config.yaml` | `public/`、`public-notes/`        |
| 匿名互动        | 文章点赞、唯一浏览与持久化         | `services/reactions/`             | SQLite 数据文件                   |
| 边缘路由        | TLS、域名分流和 API 代理           | `deploy/nginx.conf`               | `markz-edge`                      |
| 独立工具        | JSONUtils、装箱单                  | 各自仓库                          | 独立产品界面                      |

## 数据流

```text
private zhang99667/note
  -> blog repository GitHub Action
  -> sync-notes.mjs
  -> content/site + content/notes
  -> Quartz builds
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
  -> SQLite reactions.sqlite
```

设计数据走单独的生成链：

```text
tokens.json
  -> generate.mjs
  -> brand.generated.ts + _brand.generated.scss + PNG assets
  -> blog + notes builds
```

## 运行时路由

- `markz.fun`：博客静态文件；`/notes/` 是笔记回退入口。
- `note.markz.fun`：独立笔记静态文件。
- `markz.fun/api/reactions`、`note.markz.fun/api/reactions`：同一个匿名互动服务，按 `site + canonical slug` 分开计算点赞和唯一浏览；`/api/reactions/view` 幂等登记当前浏览器的文章浏览。
- `jsonutils.markz.fun`：JSONUtils 前端与 `/api/` 代理；`/admin` 进入后台。
- `zhangjihao.markz.fun`：装箱单产品。
- 只有 `markz-edge` 可以绑定宿主机 `80/443`。
- `markz-reactions` 只加入 edge 内部网络，不发布宿主机端口，也不加入 JSONUtils 网络。

## 所有权规则

- 公开源码归 `zhang99667/blog`；原始笔记归私有 `zhang99667/note`。
- `content/site/`、`content/notes/`、`public/` 和 `public-notes/` 都是生成目录，不进入公开仓库。
- 定时发布和服务器密钥归 blog；note 最多发送更新通知，不拥有构建或部署职责。
- 品牌值归 `design-system/tokens.json`。
- 页面结构归 Quartz 组件或 `scripts/sync-notes.mjs` 模板。
- 生成目录没有编辑权。
- 路由归 edge 配置，工具 Compose 不能接管公网端口。
- 点赞和浏览数据归 blog 系统；服务端只保存浏览器随机 ID 的 SHA-256，不保存 IP。数据库目录不参与静态文件 `rsync --delete`。
- 用户纠偏归 `docs/AI-DECISIONS.md`，可判定规则必须进入自动门禁。
- 第三方组件的兼容修复归本仓库源码和浏览器门禁，不能依赖 `.quartz/` 插件缓存中的手工改动。

## 自动同步

`markz-publish.yaml` 在 `main` 更新、每小时定时、手动触发或收到 `notes-updated` dispatch 时运行。它使用只读 deploy key 将私有 note 仓库签出到 `.cache/note`，然后执行仓库内唯一的同步实现。

同步分两层增量：

1. `sync-notes.mjs` 对输出计算 SHA-256，仅重写变化文件，并删除源端已移除的公开文件。
2. `deploy.mjs` 使用 `rsync --delete`，只向服务器传输文件差异并清理过期产物。

公开日期的权威顺序是源笔记 frontmatter、note 仓库文件 Git 历史。同步器把稳定的 `created`、`modified` 写入生成 Markdown；checkout 时间和生成文件 `mtime` 不能成为公开日期。列表和正文头部统一显示作者指定的 `date/created` 编辑日期，`modified` 保留用于更新元数据，不能悄悄替换公开显示日期。

生成内容虽然被 Git 忽略，项目构建脚本会显式设置 `QUARTZ_INCLUDE_GITIGNORED=1` 让 Quartz 读取它们；Quartz 的默认 gitignore 行为保持不变。构建和质量门禁每次从受控输入重新执行，避免复用不完整的远端状态。周期同步不需要 note Action；若需要推送后即时发布，note Action 只负责调用 blog 的 `repository_dispatch`，不接触服务器。

## 变更影响面

| 变更        | 最小影响面            | 必须扩大的验证                     |
| ----------- | --------------------- | ---------------------------------- |
| 设计令牌    | 博客、笔记、品牌图片  | 主题、三个视口、无障碍             |
| 同步筛选    | 内容目录、索引、链接  | 公开范围、构建、断链               |
| Quartz 组件 | 对应 frame 或页面类型 | 真实构建页面、SPA 导航             |
| edge 配置   | 所有公网域名          | Nginx 测试、端口所有权、生产 smoke |
| AI 规则     | Agent 行为与 CI       | manifest、eval runner、资产注册表  |
