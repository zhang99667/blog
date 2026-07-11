# MarkZ Design System

这份文档定义 MarkZ 个人品牌在博客和公开笔记中的长期视觉规则。它描述意图和边界；机器值以 `design-system/tokens.json` 为准，对标依据见 `docs/SYSTEM-BENCHMARKS.md`。

## 1. 系统结构

设计系统按以下单向链路工作：

```text
design-system/tokens.json
  -> scripts/design-system/generate.mjs
  -> quartz/brand.generated.ts
  -> quartz/styles/_brand.generated.scss
  -> BrandMark / Quartz theme / favicon / social card
  -> blog + notes
```

规则：

- 只在 `design-system/tokens.json` 修改颜色、字体、圆角、主要宽度和品牌资产版本。
- `quartz/brand.generated.ts`、`quartz/styles/_brand.generated.scss` 和品牌 PNG 都是生成物，不手改。
- `quartz/components/BrandMark.tsx` 是应用中的字标组件。
- `design-system/reference/markz-wordmark.png` 是用户确认的视觉参考，不直接作为网页图片使用。
- 修改后运行 `npm run design:generate`，再运行 `npm run design:check`。

## 2. 视觉方向

关键词：干净、硬朗、克制、编辑感。

- 字标是粗重无衬线字 `MarkZ` 加一个蓝色句点，以 `design-system/reference/markz-wordmark.png` 为视觉基准。
- 页面依赖排版、网格、分隔线和留白建立秩序，不使用装饰性渐变、光斑或悬浮大卡片。
- 蓝色只承担品牌句点、链接、焦点和明确主操作，不铺满页面。
- 圆角保持小而克制。普通控件和图片使用统一的 4px 半径。
- 动效只用于状态反馈，时长短，且必须尊重 `prefers-reduced-motion`。

## 3. 品牌字标

字标结构：

```html
<a class="brand-mark" data-brand-version="1.2.0">
  MarkZ<span class="brand-dot" aria-hidden="true"></span>
</a>
```

要求：

- 使用 `Noto Sans SC` 和设计令牌中的 `wordmarkWeight`，不再使用等宽体。
- 句点直径为字高的 `dotScale`，当前为 `0.23em`。
- 句点跟随主题色：浅色模式使用深蓝，深色模式使用亮蓝。
- 字标不能改写为 `MarkZ Notes`、`MarkZ Blog` 或产品口号。
- 站点角色通过页面标题、眉题和正文表达，不污染主字标。
- favicon 可使用 `MZ.` 紧凑变体；正文和导航使用完整 `MarkZ.`。

## 4. 站点边界

| 入口                   | 角色     | 主身份           | 视觉约束                             |
| ---------------------- | -------- | ---------------- | ------------------------------------ |
| `markz.fun`            | 个人博客 | MarkZ            | 编辑式首页和文章阅读，强调成稿       |
| `note.markz.fun`       | 公开笔记 | MarkZ            | 保留知识网络和工具密度，使用同一字标 |
| `jsonutils.markz.fun`  | 独立产品 | JSONUtils        | 保留产品名，不替换成 MarkZ           |
| `zhangjihao.markz.fun` | 独立产品 | 智能装箱单生成器 | 保留产品名，不替换成 MarkZ           |

博客、笔记和工具可以互相链接，但不能因为都属于同一域名就做成一个视觉和信息架构混合体。

## 5. 排版与布局

- 品牌字标：`Noto Sans SC ExtraBold`。
- 中文标题与文章标题：`Noto Serif SC`。
- 正文与界面文字：`Noto Sans SC`。
- 代码：`JetBrains Mono`。
- 字号只使用 `typeScale` 的 display、headline、title、body、label 层级；新增层级必须先说明现有层级为何不够。
- 间距优先使用 `spacing` 比例尺，组件内部只保留确实不能复用的几何值。
- 博客外壳、首页、文章和归档宽度必须使用生成的语义变量，不在组件里重新写像素值。
- 页面文字不随视口连续缩放。只在明确断点调整字号和布局。
- 320px 和 390px 宽度下，字标、导航、按钮和标题不得重叠或溢出。

令牌分层：

1. 基础：颜色、间距、字号、断点、形状、动效。
2. 语义：画布、文字、边线、强调色、阅读宽度、焦点和目标尺寸。
3. 组件：只在组件确有独立语义时增加，不能用组件令牌复制基础值。

## 6. 组件规则

### 导航

- 顶部导航是紧凑文本入口，不使用胶囊按钮。
- 当前页使用底边线和文字颜色变化，不改变布局尺寸。
- 手机端允许收起低优先级入口，但必须保留“文章”和“笔记”。

### 按钮与链接

- 只有清晰命令使用按钮外观。
- 主操作使用品牌蓝底，次操作使用边框。
- 焦点状态必须可见，不能只依赖 hover。
- 紧凑控件命中区域不得低于 24px，主要操作使用 44px 舒适目标。

### 内容和卡片

- 文章列表优先使用行和分隔线。
- 卡片只用于独立、重复、确实需要边界的项目。
- 不在卡片里再嵌套卡片。

### 图片与品牌资产

- favicon 和分享图由 `npm run design:generate` 生成。
- 修改字标、颜色或分享图后递增 `brand.assetRevision`，避免旧缓存继续生效。
- 产品截图必须展示真实界面，不使用模糊的氛围图代替产品状态。

### 无障碍与阅读

- 普通文字与画布的最低对比度是 `4.5:1`，大字号和非文字界面是 `3:1`；阈值由 `tokens.accessibility` 定义并由 `design:check` 计算验证。
- 正文代码使用 GitHub High Contrast 浅色和深色主题，不能为了接近编辑器原色而降低可读性。
- 每个页面必须有且只有一个 `<main>`；页头、主导航和页脚使用对应语义元素。
- 横向滚动的表格和代码必须可由键盘聚焦，并使用统一焦点样式。
- 页面初次打开不得被侧栏组件带离顶部；带锚点的深链接必须仍能定位目标标题。
- 第三方组件的语义兼容修复保存在本仓库受控源码中，不能只改会被插件更新覆盖的 `.quartz/` 缓存。
- 固定浅色画布的技术 SVG 在深色页面中仍使用 `color-scheme: light`，避免浏览器重映射内部填充色；照片和其他位图不做反色处理。

## 7. 视觉验收矩阵

每次改变品牌、布局、导航或响应式样式，至少检查：

| 页面     | 320x800 | 390x844 | 1440x900 | 浅色 | 深色 |
| -------- | ------- | ------- | -------- | ---- | ---- |
| 博客首页 | 必须    | 必须    | 必须     | 必须 | 必须 |
| 博客文章 | 必须    | 必须    | 必须     | 必须 | 必须 |
| 笔记首页 | 必须    | 必须    | 必须     | 必须 | 必须 |
| 笔记正文 | 必须    | 必须    | 必须     | 必须 | 必须 |

同时运行 WCAG 2.2 A/AA 自动审计，并检查 favicon、分享图 URL、键盘焦点、长中文标题和主导航不重叠。自动审计不能替代人工阅读与交互检查。

## 8. 变更协议

1. 先读取 `design-system/manifest.json`，确认改动属于个人品牌还是独立产品。
2. 需要新增设计值时先扩展 `tokens.json`，不要在 SCSS 中写字面颜色。
3. 复用或扩展现有组件；品牌入口必须使用 `BrandMark`。
4. 运行 `npm run design:generate`。
5. 运行 `npm run design:check`、`npm test` 和 `npm run build`。
6. 运行 `npm run quality:build` 和 `npm run quality:web`，按视觉验收矩阵检查页面。
7. 用户纠偏或出现重复问题时，把结论写入 `docs/AI-DECISIONS.md`，并补自动检查。

## 9. 禁止事项

- 不直接编辑生成的主题、SCSS 或 PNG。
- 不在业务 SCSS 中新增十六进制、RGB 或 RGBA 字面颜色。
- 不复制一份新的 MarkZ 字标结构。
- 不把笔记站重新命名为 `MarkZ Notes`。
- 不把 JSONUtils 或装箱单产品名替换为个人字标。
- 不用一次截图通过来证明全部响应式和主题状态正确。
