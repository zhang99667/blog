# MarkZ System Benchmarks

MarkZ 不复制任何单一产品的外观。对标的目标是吸收成熟系统的结构化能力，再形成适合个人博客、公开笔记和独立工具边界的方案。

## 视觉系统

| 参考                                                           | 采用的原则                                      | MarkZ 落点                                                         |
| -------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| [GitHub Primer](https://primer.style/product/getting-started/) | 分层令牌、语义命名、组件级无障碍、紧凑效率      | 基础令牌、语义变量、对比度计算、组件契约、浏览器无障碍门禁         |
| [Vercel Geist](https://vercel.com/geist/introduction)          | 字体、颜色、网格和图标形成一致基础              | MarkZ 字标、克制色彩、稳定内容宽度、版本化品牌资产                 |
| [GOV.UK Design System](https://design-system.service.gov.uk/)  | 移动优先、语义 HTML、渐进增强、持续可访问性验收 | 320px 起的响应式矩阵、语义主区、键盘滚动容器、WCAG 2.2 AA 自动检查 |

不采用：营销式大卡片、装饰渐变、过量动效、把博客和笔记强行合并成同一种页面密度。

## 内容发现与阅读连续性

| 参考                                                                                                            | 采用的原则                                                     | MarkZ 落点                                                          |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Google canonical 指南](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) | 每个可索引页面提供一致的自引用 canonical，重复入口指向权威 URL | 博客、笔记与 `/notes/` 回退明确分域 canonical；回退页同时 `noindex` |
| [Google Article 结构化数据](https://developers.google.com/search/docs/appearance/structured-data/article)       | 文章声明标题、作者、发布日期、修改日期和代表图                 | 博客成稿输出 `BlogPosting` JSON-LD 与 article Open Graph 元数据     |
| [Google robots.txt 指南](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)              | robots 位于站点根路径，并显式关联对应 sitemap                  | 两个域名各自生成根 `robots.txt`，博客 RSS 只分发整理后的成稿        |

阅读连续性不依赖行为追踪或黑盒推荐。优先使用正文显式关系，其次才是反向引用、共同标签和同集合；最多三项，以文章列表式横线行呈现。无可信关系时允许不展示。

## 访问统计

| 参考                                                                            | 采用的原则                                | MarkZ 落点                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| [GoatCounter visitor counter](https://www.goatcounter.com/help/visitor-counter) | 可以把页面计数和全站 `TOTAL` 作为公开信息 | 页脚公开累计访客；不把管理分析面板搬到公开页面             |
| [Umami](https://docs.umami.is/docs)                                             | 无 Cookie、无指纹、区分访客与浏览量       | 访客与文章浏览分别建模，只保存随机浏览器 ID 的 SHA-256     |
| [不蒜子](https://www.busuanzi.cc/)                                              | 中文博客常见的今日访客、全站访客页脚表达  | 使用简短中文句式，但由自托管接口提供，不加载第三方统计脚本 |

不采用：第三方跨站脚本、IP/UA 指纹、按刷新次数虚增访客、公开复杂分析图表。`今天您是第 N 位访客` 按北京时间和匿名浏览器 ID 生成稳定序号；清空浏览器存储会被视为新访客。

## 边缘安全与缓存

| 参考                                                                                                                     | 采用的原则                                                     | MarkZ 落点                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------- |
| [Nginx headers module](https://nginx.org/en/docs/http/ngx_http_headers_module.html)                                      | 当前层声明 `add_header` 后不会继承父层响应头，旧版不能自动合并 | 集中 include 同时进入 TLS server 与所有缓存头 location          |
| [MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory)                                                  | 安全头必须由真实公开响应证明，不能只看配置文件                 | smoke 覆盖页面、API、静态资源、正常状态和 404                   |
| [MDN X-Content-Type-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options) | MIME 策略应覆盖所有资源类型                                    | `nosniff` 与 HSTS、防嵌入、Referrer 策略由一个只读文件统一治理  |
| [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)                                     | 先收敛脚本与资源源站，再用运行时违规事件验证真实策略           | 编辑站脚本仅本站、无 `unsafe-inline`/`unsafe-eval`，52 场景监听 |
| [Mermaid Usage](https://mermaid.js.org/config/usage.html)                                                                | 固定版本、按需加载且由站点控制运行时来源                       | 11.16.0 Tiny 发行包构建为本地 ESM，只在图表页请求               |
| [PixiJS v8 Migration](https://pixijs.com/8.x/guides/migrations/v8)                                                       | CSP 环境使用官方兼容模块替代运行时函数生成                     | 图谱 bundle 预载 `pixi.js/unsafe-eval` 兼容实现并实测无违规     |

当前 CSP 只归博客与笔记编辑表面。样式属性和 Mermaid 生成样式使用 `style-src-attr/style-src-elem 'unsafe-inline'`；`style-src` 保留同值作为 Safari 15.6 的兼容回退，但脚本仍只允许同源并禁止属性脚本和动态求值。JSONUtils 与装箱单保留独立策略，不因为共享 edge 安全 include 被覆盖。

## AI 工程系统

| 参考                                                                                                                                                    | 采用的原则                           | MarkZ 落点                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------- |
| [OpenAI AGENTS.md](https://developers.openai.com/codex/guides/agents-md)                                                                                | 从仓库到子目录的分层指令             | 根 `AGENTS.md` 加路径级指令                   |
| [OpenAI Evals](https://developers.openai.com/api/docs/guides/evals)                                                                                     | 代表性样本、明确判定标准、可重复运行 | 设计与路由场景语料、确定性 runner、结果账本   |
| [Anthropic project memory](https://docs.anthropic.com/zh-CN/docs/claude-code/memory)                                                                    | 项目事实、命令和架构模式进入共享记忆 | `CLAUDE.md` 薄入口指向同一权威图              |
| [GitHub Copilot customization](https://docs.github.com/en/copilot/how-tos/custom-instructions/adding-repository-custom-instructions-for-github-copilot) | 仓库级、路径级指令和可复用 prompt    | `.github/instructions/` 与 `.github/prompts/` |

MarkZ 在这些入口之上增加机器可读的能力账本和只读巡检：探针只能把有源码、测试或运行证据的能力标为完成，固定公式负责排序，定时工作流维护一个改进任务。它不采用让 Agent 无审批直接改生产、路由、隐私或密钥的“全自动自进化”。

## 完整度标准

- 每个规则都能追溯到一个权威文件。
- 每个高风险流程都有固定命令和证据要求。
- 每个发生过的故障都有决策记录和确定性门禁。
- 视觉验收覆盖博客/笔记、首页/正文、浅色/深色、320/390/1440 三个宽度。
- 自动检查输出可以进入 CI，不依赖某个 Agent 声称“已经看过”。

每季度或发生重大品牌、框架、Agent 平台变化时复核一次本表。新参考必须说明采用什么、不采用什么，避免无目的追随潮流。
