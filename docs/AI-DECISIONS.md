# MarkZ AI Decisions

这里记录会影响后续 AI 决策的用户纠偏和架构约束。新记录必须包含触发、决策、反例、边界和锁定证据。

## D-001 视觉修改必须进入系统

- 日期：2026-07-10
- 触发：用户明确指出，不能把确认的字标写完即止；必须形成统一视觉和可持续 AI 基建。
- 决策：建立机器可读设计令牌、生成链、统一 `BrandMark`、设计规范、项目 Skill、评测样例和自动门禁。
- 反例：在某个 TSX 或 SCSS 中直接新增颜色、宽度或另一份 `MarkZ.` HTML，然后只检查当前截图。
- 边界：独立工具产品保留自己的产品身份；共享域名不等于共享产品名称。
- 锁定证据：`npm run design:check`、`npm run ai:check`、`scripts/design-system/check.test.mjs`。

## D-002 公网入口只能由 markz-edge 持有

- 日期：2026-07-10
- 触发：JSONUtils 部署多次把 `markz.fun` 覆盖为工具首页。
- 决策：独立 `markz-edge` 持有宿主机 `80/443`；JSONUtils 前端只暴露 Docker 内网端口。
- 反例：通过 `docker-compose.override.yml` 把博客 Nginx 配置挂进 JSONUtils 前端，或在 JSONUtils Compose 中重新发布 `80/443`。
- 边界：edge 可以读取 JSONUtils 静态卷并代理 API，但 JSONUtils 部署不能拥有公网路由生命周期。
- 锁定证据：`deploy/docker-compose.edge.yml`、`deploy/nginx.conf`、`npm run ai:check` 和部署后端口检查。

## D-003 博客、笔记和工具保持角色分离

- 日期：2026-07-10
- 触发：用户认为早期主页像笔记前端，而不是个人博客。
- 决策：博客展示整理后的文章；笔记站保留网络化原始材料；工具使用独立产品身份。三者通过链接连接，不合并信息架构。
- 反例：在博客首页铺完整笔记树，或把 JSONUtils、装箱单统一改名为 MarkZ。
- 边界：博客和笔记共享个人字标、基础字体和色彩，不共享页面密度与工作流布局。
- 锁定证据：`design-system/manifest.json`、`docs/DESIGN-SYSTEM.md`、`npm run design:check`。

## D-004 字标采用粗体无衬线视觉

- 日期：2026-07-10
- 触发：用户确认新的浅底、深色粗体无衬线 `MarkZ.` 字标比等宽版本更合适。
- 决策：MarkZ v2 字标统一使用 `Noto Sans SC 800`，保留 `0.23em` 蓝点比例；网页、favicon 和分享图都从同一令牌生成。
- 反例：只替换首页字体，或让笔记、favicon、分享图继续使用旧等宽字标。
- 边界：文章代码字体仍使用 `JetBrains Mono`；本决策只改变个人品牌字标，不改变独立工具身份。
- 锁定证据：`design-system/reference/markz-wordmark.png`、`brand.wordmarkFont`、`brand.assetRevision=v2`、`npm run design:check`。

## D-005 AI 与视觉规范必须有可执行证据

- 日期：2026-07-11
- 触发：用户要求继续对标顶尖项目，形成完整视觉方案和完善 AI 基建，服务后续迭代。
- 决策：引入分层视觉令牌、320/390/1440 浏览器矩阵、WCAG 自动审计、构建质量预算、机器可读 AI manifest、路径级指令、可复用 prompt 和确定性 eval runner。
- 反例：继续增加说明文档，但 CI 不读取、任务无法重复运行、Agent 仍可绕过真实页面验收。
- 边界：自动检查提供基线证据，不替代用户审美判断、人工无障碍检查和高风险部署复核。
- 锁定证据：`ai/manifest.json`、设计 token 对比度测试、High Contrast 代码主题、语义 `<main>`、可聚焦滚动容器、`npm run evals:check`、`npm run quality:build`、`npm run quality:web`、CI 浏览器报告。

## D-006 公开代码与私有内容分离

- 日期：2026-07-11
- 触发：用户要求项目开源，并确认项目 Skill 不应安装到个人目录，同时询问 note 仓库是否需要承担同步 Action。
- 决策：Skill 保留在项目 `.codex/skills/`；`zhang99667/blog` 公开代码，`zhang99667/note` 保持私有。blog Action 主动签出 note 并负责定时构建、校验和部署；生成内容不进入公开 Git 历史。
- 反例：把 Skill 安装到 `~/.codex/skills`、将原始 note 或生成内容提交到公开仓库、让 note Action 持有服务器 SSH 私钥。
- 边界：若需要 push 后即时发布，note 可以用最小权限令牌发送 `notes-updated` dispatch，但同步与部署实现仍只存在于 blog。
- 锁定证据：`.gitignore`、`.github/workflows/markz-verify.yaml`、`.github/workflows/markz-publish.yaml`、`NOTE_REPO_PRECHECKED_OUT` 和 `npm run ai:check`。

## D-007 公开日期不依赖同步时间

- 日期：2026-07-13
- 触发：用户发现每次自动同步后，笔记日期都会整体更新成同步当天。
- 决策：同步器以源 frontmatter 为最高优先级，否则读取 note 文件的 Git 首次和最近提交时间，并把稳定的 `created`、`modified` 写入生成 Markdown。Quartz 先读 frontmatter，不能只读文件系统时间。公开列表和正文头部都显示作者指定的 `date/created` 编辑日期；`modified` 继续保留为更新元数据，但不覆盖公开显示日期。
- 反例：使用源 checkout 的 `mtime`、生成文件的 `mtime`、Action 运行时间或一次批量元数据提交的 Git 修改时间替换文章公开日期，或者让列表显示 `created`、正文显示 `modified`。
- 边界：未纳入 Git 且没有日期 frontmatter 的本地新文件可以暂时回退到文件系统时间；CI 发布的文件必须有完整 Git 历史。
- 锁定证据：`scripts/sync-notes.test.mjs`、`fetch-depth: 0`、`quartz.config.yaml` 的 `defaultDateType: created` 与日期优先级、列表和正文 `<time>` 一致性浏览器测试及 `npm run build`。

## D-008 中文路由图谱必须使用 canonical slug

- 日期：2026-07-13
- 触发：用户发现 `Agent MCP 完全指南`明明关联了多篇笔记，局部关系图谱却只显示一个带 `%E5...` 标签的孤立点。
- 决策：图谱从浏览器 URL 取路径时必须先解码，再与 `contentIndex.json` 中的 canonical slug 匹配。异步渲染在读取索引后和 PIXI 初始化后都必须校验 render generation，过期渲染不能继续挂载或泄露 WebGL 上下文。兼容修复由仓库内本地组件接管，不手改 `.quartz/` 插件缓存。
- 反例：直接用 `window.location.pathname` 的百分号编码值扩展局部图，或在 `.quartz/plugins/graph` 里做一次性修改。
- 边界：外部 URL 不进入图谱；无内链且无反链的笔记可以合理地显示单点。
- 锁定证据：`quartz/components/GraphCompatibility.ts`、`GraphCompatibility.test.ts` 的 URL 与 render-generation 上游标记检查、单 worker 中文路由浏览器图谱矩阵和生产 `contentIndex.json` smoke。浏览器门禁不并行争抢 Chromium 共享 WebGL 上下文，每个用例结束显式触发 `prenav` 释放 PIXI；页面、视口与主题覆盖不能减少。

## D-009 图片预览交互使用成熟组件

- 日期：2026-07-13
- 触发：用户指出自研图片缩放容易产生交互和兼容性问题，要求确认并改用成熟组件。
- 决策：博客和笔记站统一固定使用 `PhotoSwipe 5.4.4`。仓库适配层只负责筛选文章图片、补充尺寸与语义、接入 Quartz SPA 生命周期和映射品牌令牌；缩放、拖拽、触控、图库导航、焦点圈定与焦点恢复由 PhotoSwipe 提供。PhotoSwipe 核心从本站版本化静态资源按第一次打开图片加载，不进入页面初始模块图。
- 反例：重新实现缩放比例、触摸手势、拖拽边界、焦点圈定或自制弹层工具栏，或者使用浮动版本导致交互在无人复核时改变。
- 边界：链接图片和图谱、Mermaid、Canvas、Excalidraw 等交互内容不接管；升级 PhotoSwipe 主版本前必须重新通过浏览器矩阵和无障碍检查。
- 锁定证据：精确依赖版本、`ImageLightbox.test.ts`、初始与总 JS 双预算、博客和笔记的 320/390/1440 浅深色浏览器用例、SPA 与同文图库导航用例。

## D-010 匿名点赞属于博客独立运行时

- 日期：2026-07-13；2026-07-14 交互纠偏
- 触发：用户要求在笔记或博客增加点赞功能，随后指出文末入口不符合真实阅读行为，并要求用图标替代廉价的可见状态文字、在点赞旁增加文章浏览量；上线后继续发现宽屏视口角落离阅读列太远，专注正文时难以注意。
- 决策：博客和笔记正文共用一条紧凑的图标互动栏，并从正文首屏开始固定悬浮。桌面端读取正文真实边界并锚定在正文右侧一个安全间距内，空间不足时才退回视口右下安全区；不能把宽屏视口边缘当作默认锚点。可见界面固定为 Lucide `Eye + 浏览数` 和 `ThumbsUp + 点赞数`，不展示“赞”“已赞”“谢谢”等状态文案；语义和反馈保留在 `aria-label` 与读屏状态区。点赞和浏览按 `site + canonical slug` 独立；浏览量定义为同一匿名浏览器对同一文章只计一次。独立 `markz-reactions` 服务使用 SQLite 的 `reactions`、`views` 唯一键保证持久化与幂等；浏览器随机 ID 经 SHA-256 后保存，来源 IP 只在 Nginx 限流内存中短暂使用，不进入数据库。服务没有宿主机端口，也不复用 JSONUtils API 或数据库。部署在同步服务代码后必须强制重建 reactions 容器并等待健康，不能假设只读 bind mount 的文件变化会重启现有 Node 进程。
- 反例：只在 `localStorage` 伪造公共计数、把互动入口仅放在文章末尾或宽屏视口角落、用可见文字堆叠状态、自绘通用图标、按刷新次数虚增浏览量、把接口塞进 JSONUtils、为匿名互动引入账号系统，或让数据库目录进入静态站 `rsync --delete` 范围。
- 边界：博客成稿与原始笔记是不同内容表面，默认不合并计数；清空浏览器存储后可再次计入点赞和浏览，当前不承诺账号级防刷或精确用户分析。首页、目录、标签、Canvas 和 Bases 页面不展示互动栏。
- 锁定证据：reactions API 的点赞与浏览幂等、并发、旧库迁移和持久化测试，Lucide 精确依赖，Compose 无公网端口契约，Nginx 精确路由与写限流测试，部署脚本的 `--force-recreate --wait reactions` 顺序检查，两站正文首屏图标栏、正文边缘锚定或窄屏安全区断言、多视口双主题和 SPA 浏览器用例，以及生产健康、幂等写入与端口 smoke。Lucide 图标数据使同时包含博客与笔记回退产物的 blog 总 JS 上限从 485 KB 调整到 490 KB；200 KB 首屏上限与 notes 总量上限保持不变。

## D-011 移动端收起的笔记目录必须完全离开视口

- 日期：2026-07-14
- 触发：互动栏视觉检查和 390px 并发门禁反复发现笔记目录收起后仍在视口左侧泄露约 16px，既产生横向滚动，也露出残缺文字。
- 决策：移动端目录面板的绝对定位必须抵消页面 16px 安全边距；收起状态的右边界不得大于视口左边界 1px，打开状态仍覆盖完整视口。
- 反例：只隐藏溢出条、放宽横向滚动断言，或接受页面左边出现残缺目录文字。
- 边界：只约束 320px 和 390px 的笔记目录收起状态；桌面目录布局、打开后的全屏覆盖和博客 frame 不受这一偏移规则影响。
- 锁定证据：notes 的 320px、390px 浅深色浏览器矩阵显式断言收起目录 `right <= 1px`，全页继续断言没有横向溢出。

## D-012 博客访客数是公开但匿名的页脚信息

- 日期：2026-07-14
- 触发：用户希望在博客底部显示“今天您是第几位访客”和累计访客，并要求参考网上成熟做法后上线。
- 决策：只在博客页脚显示一行低干扰文本，不扩展到笔记或工具站。复用自托管 `markz-reactions` 与现有浏览器随机 ID；服务端仅保存 SHA-256。`visitors` 记录累计唯一访客，`daily_visitors` 按 `Asia/Shanghai` 保存当天稳定序号。同一页面文档内的 SPA 跳转不重复请求；只读 `GET /api/visitors` 供生产检查且不污染计数。首次迁移把已有博客文章互动哈希作为累计基线，不伪造历史日序号。
- 反例：按刷新次数递增、用 IP 与 User-Agent 生成指纹、引入第三方跨站统计脚本、让生产 smoke 每天占一个访客序号、把计数做成醒目的卡片或在接口失败时显示 `0`。
- 边界：匿名浏览器不是账号；跨设备、隐私模式或清空本地存储会被视为新访客。累计数是轻量公开反馈，不承诺广告分析级精度或防刷能力。
- 锁定证据：北京时间跨日、幂等、并发、迁移和哈希持久化服务测试；`/api/visitors` 仅博客域名精确代理；博客首页与正文的 320/390/1440 浅深色浏览器矩阵、SPA 复用、API 失败隐藏和生产只读 smoke。

## D-013 成熟度演进必须由证据和风险边界驱动

- 日期：2026-07-14
- 触发：用户要求按成熟博客标准持续迭代，并让 AI 基建具备可持续的自我演进能力。
- 决策：`ai/evolution.json` 统一登记能力、评分、探针、验证和风险；`evolve.mjs` 只根据仓库确定性证据产出报告并运行代表性 eval，周任务只维护一个改进 issue。每轮只实现一个边界明确的最高优先能力，再用同一报告证明状态变化。首个读者连续性能力由同步器静态生成：正文显式链接优先，其次是反向引用、共同标签和同集合，只推荐博客成稿且最多三篇。发现层同时补齐分域 canonical、`BlogPosting`、RSS、robots 和单一字体来源。
- 反例：让 Agent 根据开放式审美循环直接提交或部署；把一次建议写进 issue 就标成完成；自动修改路由、隐私、密钥或执行破坏性操作；为凑数量推荐无关文章；在浏览器运行黑盒推荐并收集额外行为数据。
- 边界：自主化只覆盖只读审计、排序和报告。能力评分用于决定调查顺序，不替代人工产品判断；`critical`、隐私、外部密钥、破坏性操作和证据不足的变化始终需要人工选择并走完整门禁。无可信相关文章时允许不渲染继续阅读。
- 锁定证据：`ai/evolution.schema.json`、`ai/evolution.json`、`scripts/ai/evolve.mjs`、`markz-evolve.yaml`、连续决策字段检查、`continuous-site-evolution` eval、继续阅读排序单测和 320/390/1440 双主题浏览器矩阵、构建 SEO/RSS/robots/字体契约，以及实现前后的 `npm run evolve:report`。

## D-014 运行时数据库先证明可恢复，再谈备份完成

- 日期：2026-07-14
- 触发：成熟度巡检发现点赞、唯一浏览和访客数据只有单机 SQLite 持久化，没有自动一致快照、保留策略或恢复证据。
- 决策：用独立 `markz-reactions-backup` sidecar 通过 Node SQLite online backup API 每 6 小时读取一次在线数据库；源目录只读、容器无网络，快照目录独立且私有。在线副本发布前必须转换成不依赖 WAL/SHM 的 `DELETE` journal 单文件，再通过 `integrity_check`、`foreign_key_check`、SHA-256 和表行数清单；目录不得残留 sidecar 或 `.partial`，保留最近 32 份。每次生产 smoke 必须从 latest 恢复出新数据库并再次校验，恢复命令拒绝覆盖已有目标。
- 反例：直接复制 WAL 模式下正在写入的单个 `.sqlite` 文件；只检查文件存在或 HTTP 200；让备份容器获得公网；在恢复演练中覆盖生产库；把个人 SSH 私钥派生成数据库加密密钥；把明文匿名哈希上传到公开 artifact。
- 边界：当前快照与源数据库位于同一服务器，只覆盖数据库级和误操作恢复，不覆盖主机、磁盘或账号级故障。完整 `runtime-backup` 能力仍需用户确认独立加密密钥和异地存储，探针在此之前必须保持未完成。
- 锁定证据：在线写入中的快照、独立 journal mode、sidecar 清理、权限、保留、陈旧/损坏拒绝、互斥锁、禁止覆盖和恢复演练单测；Compose 的只读源挂载、无网络和健康检查契约；部署等待双服务健康；生产 smoke 的无端口断言和真实恢复演练。

## D-015 私有双链不能成为公开断链

- 日期：2026-07-14
- 触发：成熟度报告记录了 54 条博客回退与笔记站断链；根因是同步器在尚未确定公开集合时原样输出 Obsidian 双链和本地 Markdown 链接。
- 决策：同步器先完成公开筛选并建立笔记、文件夹和资产索引，再生成正文。公开目标改写为带完整公开 ID 的 Quartz 双链，继续进入关系图谱和回链；私有、被过滤或缺失目标只保留显示标题，缺失嵌入不输出链接。公开断链基线收紧为零，以完整双站构建结果判定。
- 反例：把 404 继续登记进 baseline；把所有链接改成外部 URL 导致图谱失联；修改私有 note 仓库补假页面；在代码块内重写示例；仅修当前截图中的一篇文章。
- 边界：降级只作用于构建当次无法证明公开的本地目标；HTTP(S)、自定义协议、代码块、已公开资产和可解析文件夹保持原语义。源 Obsidian 内容不因公开策略被反向修改。
- 锁定证据：公开笔记双阶段重写单测、公开/私有/文件夹/外链/代码块用例、129 篇笔记完整同步、博客回退与独立笔记构建，以及 `quality:build` 实测 0 条 broken reference 和空 baseline。

## D-016 图谱运行时不能把可用性外包给公共 CDN

- 日期：2026-07-14
- 触发：完整发布门禁在桌面浅色图谱用例中没有生成 canvas；trace 证明 D3/Pixi 的 jsDelivr 请求失败，重跑可能偶然通过但不能消除线上空白风险。
- 决策：保留成熟的上游 D3 + Pixi 图谱实现，精确锁定依赖版本；构建期只打包图谱实际使用的导出，并通过 Quartz 静态发射器发布到本站。兼容层按 `data-basepath` 同时支持 `note.markz.fun/static/vendor/` 和 `markz.fun/notes/static/vendor/`。博客布局不含图谱，因此不得注册或加载这段运行时。总 JS 预算只为两个可缓存本地运行时显式扩容，200 KB 初始 JS 上限不变。
- 反例：看到偶发失败就重跑 Playwright；继续依赖浮动主版本 CDN；手改 `.quartz` 缓存；复制完整未裁剪发行包；为了通过体积检查把本地动态脚本排除在总预算之外；让没有图谱的博客也下载渲染引擎。
- 边界：字体等其他外部资源按各自决策治理；本决策只覆盖关系图谱浏览器运行时。升级 D3、Pixi 或上游 Graph 插件时，必须同步版本、兼容标记、体积上限和浏览器矩阵。
- 锁定证据：`graphRuntimeAssets.ts` 的版本与导出白名单、`GraphCompatibility.ts` 的双入口 URL 改写和上游漂移失败、Static emitter、构建产物无 jsDelivr 与资产存在检查、`graph-runtime-resilience` eval，以及 320/390/1440 浅深色真实 canvas 门禁。

## D-017 文章分享图必须内容可识别且构建可复现

- 日期：2026-07-14
- 触发：成熟度报告发现全部文章共用通用品牌卡片，分享后无法从图片识别文章；现成 OG 插件还会为全部笔记生成图片并在构建期下载远程字体。
- 决策：只为博客成稿生成文章级 1200x630 PNG。同步器从文章标题、日期、分类、设计令牌、渲染器版本和固定字体校验和计算内容寻址 URL；Sharp 使用仓库内 Noto Sans SC WOFF 渲染，未变化图片复用缓存，陈旧图片自动删除。首页、归档、笔记和回退页继续使用通用品牌图。Open Graph、Twitter 和 `BlogPosting.image` 必须引用同一真实 URL。
- 反例：所有文章继续共用 `markz-card-v2.png`；为了让探针通过直接启用会下载远程字体并覆盖全部笔记的通用 OG 插件；依赖构建机器的系统中文字体；把生成 PNG 提交为手工设计源；元数据引用三张不同图片；只检查 HTTP 200 而不检查尺寸、标题和体积。
- 边界：文章分享图是分发元数据，不改变正文 UI，也不为公开笔记逐篇生成卡片。固定 WOFF 只用于构建，不作为浏览器字体发布；改变视觉布局必须递增渲染器版本，改变字体必须同时更新来源、许可、校验和和 URL。
- 锁定证据：`article-social-images.mjs` 的内容哈希、三行标题和字体校验，生成器图像单测，Static emitter 的博客限定，Head 的统一 URL，逐篇 1200x630/PNG/唯一性/单图与总量构建预算，生产文章 HTML 与 PNG 下载解码 smoke，`article-social-image-governance` eval，以及最短、最长和中英混排卡片人工像素检查。

## D-018 CI Action 既要及时升级，也要不可变

- 日期：2026-07-14
- 触发：发布工作流虽然成功，但 GitHub 明确警告 `actions/upload-artifact@v4` 仍运行 Node 20 并将被强制切换到 Node 24；现有门禁只检查 Action 名称存在，没有识别已淘汰运行时或浮动标签。
- 决策：验证、发布和演进工作流中的所有远程 Action 固定到其官方发布的完整 commit SHA，并在同行保留精确语义版本注释。官方 Action 升级到当前 Node 24 兼容稳定版；`.github/dependabot.yml` 至少每周检查 `github-actions`。确定性探针解析全部工作流 YAML，拒绝非完整 SHA、缺少版本注释和低于治理基线的主版本。
- 反例：忽略兼容模式告警；只把 `upload-artifact` 改成可移动的 `@v7`；固定 SHA 却删除版本注释导致无法审计与更新；只升级发布工作流而遗漏验证或演进工作流；关闭 Dependabot 后靠偶尔人工搜索新版本。
- 边界：离线探针验证引用形态、版本基线和更新通道，不声称仅凭源码就证明任意 SHA 的上游归属；首次和重大升级仍需从官方仓库核验提交并让全部远端工作流真实运行。本仓库使用 GitHub-hosted runner，自托管 runner 的最低版本兼容性不在本决策覆盖范围内。
- 锁定证据：GitHub 官方发布记录与提交 API、三个工作流的完整 SHA 和同行版本注释、`ci-action-lifecycle` 演进探针、浮动引用与旧主版本回归单测、`ci-action-supply-chain` eval、Dependabot GitHub Actions 配置，以及远端 Verify、Publish、Evolution 的无淘汰告警运行。

## D-019 安全响应头必须覆盖 Nginx 的每个响应上下文

- 日期：2026-07-14
- 触发：生产实测发现文章页返回 HSTS、`nosniff`、防嵌入和 Referrer 策略，但博客首页、JSONUtils 首页和静态 CSS 全部缺失；这些 location 为缓存单独声明了 `add_header`，从而覆盖了 server 层继承。
- 决策：四项既有安全头集中到只读 `deploy/security-headers.inc`。部署脚本显式同步，edge Compose 显式挂载；每个 TLS server 引用一次，任何自行声明 `add_header` 的 location 必须在同一层再次引用。代理响应先隐藏上游同名头再由 edge 统一输出一份；Referrer 策略通过 map 保留上游更严格的值，静态响应回落到站点默认值。确定性解析器检查所有 Nginx block、隐藏规则和策略 map，生产 smoke 检查各域名页面、API、静态资源和真实 404，并拒绝重复或冲突值。
- 反例：只给博客首页复制四行；看到文章页正常就宣称全站正常；让 edge 与 API 同时输出相同安全头；用站点默认 Referrer 策略覆盖上游更严格策略；升级 Nginx 来掩盖当前配置错误；删除 `no-store` 或 immutable 缓存策略以恢复继承；只 grep 配置而不读取线上响应头。
- 边界：本决策统一当前 HSTS、MIME、防嵌入和 Referrer 基线，不顺带改变独立工具权限，也不声称已经具备 Content Security Policy。CSP 需要先外置 Quartz 可执行内联脚本、盘点资源源站并通过浏览器策略违规门禁，作为独立演进能力处理。
- 锁定证据：Nginx 官方继承规则、集中 include、上游隐藏规则与 Referrer map、Compose 只读挂载、部署同步、上下文解析回归测试、`security-header-inheritance` eval、远端 `nginx -t`，以及博客、笔记、JSONUtils、后台、装箱单、API、静态图片和 404 的生产响应头 smoke。

## D-020 CSP 必须约束真实运行时而不是放宽脚本

- 日期：2026-07-14
- 触发：成熟度报告把 Content Security Policy 排为最高优先缺口；产物审计发现每页内容索引、404 大小写恢复、Explorer 函数反序列化、Mermaid CDN 和 Pixi 动态函数生成会阻止严格策略。
- 决策：`deploy/nginx.conf` 只保存一份编辑站 CSP，通过 host map 精确覆盖 `markz.fun`、`www.markz.fun` 和 `note.markz.fun`，默认空值让 JSONUtils、后台与装箱单保留自身 CSP 所有权；集中 include 只负责发射。脚本限定同源，`script-src-attr`、`base-uri`、`object-src` 和 `frame-ancestors` 为 `none`，不允许脚本 `unsafe-inline` 或 `unsafe-eval`。内容索引进入外部 prescript，404 进入组件脚本；Explorer 移除函数反序列化并拒绝未治理自定义回调；Mermaid 11.16.0 Tiny 固定包构建成本地 ESM，Pixi 使用官方 CSP 兼容模块。Shiki 属性样式和 Mermaid 生成样式由 `style-src-attr/style-src-elem` 许可，`style-src` 保留相同内联样式许可作为 Safari 15.6 回退。200 KB 核心 JS 上限不变；2.55 MB 按需 Mermaid 文件计入总 JS，blog/notes 总上限按实测收紧为 3.7/3.5 MB。
- 反例：用 `script-src 'unsafe-inline'` 或 `'unsafe-eval'` 快速消除报错；给所有域名下发同一 CSP；保留每页内联启动代码；把 Mermaid、D3 或 Pixi 放回公共 CDN；只检查响应头存在而不运行页面；把按需 vendor 从总资源预算中完全排除。
- 边界：CSP 不替代依赖审计、输入净化或产品权限。Google 字体仍按设计系统决策显式允许；YouTube frame 是已配置能力但当前内容不必加载。未来新增外部图片、连接、frame、Explorer 行为或脚本源，必须先修改权威策略和确定性门禁，不能临时加通配符。`pixi.js/unsafe-eval` 是官方命名的静态兼容模块，不等于策略允许动态求值，最终以浏览器无违规为准。
- 锁定证据：Nginx host map 解析测试、327 个 HTML 的零可执行内联脚本与资源源站检查、Explorer/Mermaid/Pixi 兼容单测、自托管资产和总量预算、保持 200 KB 的核心脚本预算、所有 52 个 Playwright 场景的 `securitypolicyviolation` 监听、Mermaid/图谱/404 专项交互、`content-security-policy-runtime` eval、生产精确响应头 smoke，以及实现前后 13/15 到 14/15 的演进报告。
