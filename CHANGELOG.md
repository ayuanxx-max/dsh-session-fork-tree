# Changelog · 更新记录

## 0.9.34 — 2026-11-06

- **修复：点开侧栏「···」菜单就消失 / 乱跳（本次 DSH 升级后出现）**。三个原因叠在一起：
  - 排序把**非会话子节点**一律编号：分组里的「···」溢出按钮拿 `-1`、页脚拿 `n+i`。DSH 0.2.x 的分组容器现在同时装行、溢出按钮和它打开的菜单——菜单是后插入的节点，没有号（默认 `0`），于是排到组首，把「···」锚点整体推下约 30 px，用户看到的就是「点一下菜单没了」。
  - MutationObserver 只装在**第一个**列表上，还带 150 ms 防抖：新节点在下一帧之前拿不到槽位。现在每个容器各挂一个 observer，用 `queueMicrotask` 合并，**首帧前**完成编排（fixture 断言：菜单第一帧 `order` 已是 `4`）。
  - 含 popover 的容器改用**槽位保持模式**：只置换会话行的位次，按钮/菜单/toast/分隔线保持宿主给的槽位；容器样式（`display`/`flex-direction`）一根手指都不碰。block 容器仅在无 popover 的普通列表里才转 flex（0.9.32 的路径不变）。
- **与 DSH 版本解耦**：模式在容器首次出现时判定并**粘住**（banded / inplace），不会中途切换；banded 容器遇到无法归类的行间外来节点只冻结、不重排；不再依赖 `NSkPbW_*` 之类宿主类名，只用 `[data-row-key^="session:"]`、`aria-haspopup`、文本等公开契约。最坏情况是「排序静默降级、装饰照常」，而不是报错或弄坏宿主 UI。
- **性能（实测，40 行）**：空跑 pass 0.21 ms（200 次 41.7 ms 中位），强制每轮重写 order 0.245 ms/pass（100 次 24.5 ms）。一次交互只跑 1–2 个 pass，远低于一帧 16.7 ms，故「无延迟」。见 `verify/perf.html` + `verify/scenarios/perf.json`。
- **新增真实 DOM 回归** `verify/menu.html` + `verify/scenarios/menu.json`（11 项）：菜单节点还在、锚点不动、菜单两轮 pass 间 order 不变、第一帧前拿到槽位、行间 toast 不被挤走、容器不被改成 flex、树序仍为 c1→c2。`verify/arrange.html` 13/13 保持全绿。
- 验证钩子：`window.__ftApply()`（跑一次 pass）、`window.__ftPasses`（pass 计数），供 fixture 与线上排障使用。
- Fixes the disappearing "···" menu after the DSH sidebar rewrite: non-session children (overflow button, menu) were banded into the order plan and the container's layout was rewritten. Container-hosting-popover groups now use slot-preserving ordering, observers are per-container and microtask-batched (applied before the first frame), and the mode is decided once per container so no upgrade can flip it mid-session.

## 0.9.33 — 2026-11-06

- **分叉默认折叠，点 `+` 才展开**（按用户要求，覆盖 0.9.29 的「默认全展开」）：凡是**真有子行**的会话默认收起，整棵子树隐藏，行尾是 `+`；点开变 `−`，再点收起。没有分叉的会话永远不折叠。
  - 状态集合从 `collapsed`（记"被收起的"）改成 `expanded`（记"被打开的"）：新出现的分叉默认是关的，不会一启动就刷出一堆子行。
  - 子行挂载时**顺手给父行补上 `+`**：默认折叠后，父行若不再重渲染，就会出现「子行被藏起来、却没有按钮能展开」的死角。
  - 正在查看的会话（行上有 `aria-current="true"` / `data-active`）其祖先链自动展开一次，之后用户可以自己收起。
  - 按钮 `title` 带子行数量：`展开分叉 (2)`。
- Fixture 扩到 14 项断言：默认只剩根行、`+`/`−` 只出现在有子行的行上、全展开后 7 行可见、收起整棵子树、以及原有排列/顺序/零写入断言。
- Forks are collapsed by default now: `+` opens a branch, `−` closes it. A session without forks never collapses; the row being viewed auto-opens its ancestors once.

## 0.9.32 — 2026-11-06

- **组标题（非会话行）顺序被写反**：block 分支用递减计数器写 `order = -1, -2, -3…`，而 flex 里数值小的先渲染，所以同一分组里两个以上的标题/按钮会**倒着排**。改为升序负数（`-m … -1`），保持原生相对顺序。
- **`收起` 页脚改为容器内计算**：删掉全局 `pinFooters()`——它扫描全页 `button/div/span/a`，把命中节点的**任意祖先**（最多 4 层）强行改成 `display:flex`，可能动到整个侧栏滚动容器或分组外框。现在标题、会话、页脚在 `applyOrder` 里一次算清（标题 `-m..-1`、会话 `0..n-1`、页脚 `n..n+m-1`），不再碰容器以外的节点。
- **不再无脑重排**：以前 block 容器每次都被强转 flex 并整组重写 `order`，即使顺序已经正确；现在先算目标值，只有**真的需要变化**时才转 flex / 写值。已正确时零写入——这是「点一下行跳两下」的另一半原因。
- **页脚文本匹配收紧**：从 `/收起|折叠|展开|more|less|show/i` 改成锚定整串 `/^(收起|折叠|展开|显示更多|显示更少|Show more|Show less)$/i`，名字里带「展开」的工作区标题不会再被当成页脚排到组尾。
- **新增真实 DOM 回归**：`verify/arrange.html` + `verify/scenarios/arrange.json`（真实行结构：block 列表、两个组标题、夹在中间的「收起」、分叉树）断言：先序 DFS、子树连续、标题在前且保序、页脚在最后、二次/三次 pass 零写入、节点不被替换、点击把子行顶到组首后仍回到树序。10/10 通过。
- Group headings were ordered in reverse; footers were pinned by a DOM-wide scan that could restyle the sidebar scroll container; and every pass rewrote `order` even when the tree was already correct. All three are fixed and covered by a real-DOM fixture (10/10).

## 0.9.31 — 2026-11-06

- **恢复行排序为默认开启**：0.9.30 把它关掉后，子会话只保留缩进而不再回到父会话下方，看起来就是"父子关系全错"。排序是功能本体，必须开；`window.__DSH_FORK_TREE_ORDER__ = false` 可关闭。
- **修复菜单/交互延迟**：`decorate` 原来每次 React 渲染都对**所有行**做一遍 `refreshToggles`（18 行时 O(n²)），并每帧用 `Range.getBoundingClientRect()` 重新测量标题。现在：
  - 每行按 `depth|行宽|标题` 记签名，状态没变直接返回；
  - `refreshToggles()` 从单行装饰路径移除，只在 lineage 刷新时统一跑；
  - 新会话触发的 lineage 刷新改为 120ms 去抖（原来每行各发一次请求）。
- Ordering is back on by default (children sit under their parent); per-row decoration is memoized so hover/menu interactions no longer re-measure every row.

## 0.9.30 — 2026-11-06

- **默认不再重写行的排列顺序**（`order`）。DSH 0.2.2 自己按 lineage 排、并且在你点开会话时把它重新排序到前面；插件再写一次 `order` 会和原生排序打架，正好表现为「点一下，行上下跳两下，然后会话跑到视野外/像消失了」。缩进、连线、展开按钮都不依赖这次重排。
- 需要旧行为时在控制台执行 `window.__DSH_FORK_TREE_ORDER__ = true` 再刷新。
- Row reordering is off by default: it raced DSH's own lineage sort and reset on click.

## 0.9.29 — 2026-11-06

- **默认全展开**：把「expanded 集合」改成「collapsed 集合」。以前默认把分叉子会话全部 `display:none`，用户看到的就是"会话不见了"（本机实测启动时就有 4 条被隐藏）。现在默认全部可见，只有主动点 `−` 才折叠，`+` 表示可展开。
- 修掉重排抖动：block 分支原来按"原生子节点序号"写 `order`，而 flex 分支按 `0..n-1` 写；两次 pass 的编号规则不同 → 每次点击/重渲染都会整体重排一次，表现为"行上下串两下"。现在两个分支统一 `0..n-1`。
- 只写有变化的 `order`，顺序已正确时不产生任何写入，配合 DSH 0.2.2 原生的 lineage 排序不会再来回跳。
- Forks are visible by default; only an explicit collapse hides a subtree. Consistent order numbering stops the double reshuffle on click.

## 0.9.28 — 2026-11-06

- 修复「点一下会话，标题就消失」：`+` 标记不再插进标题 `<span>`，改为挂在**行**上的绝对定位子元素。DSH 用标题的 `scrollWidth - clientWidth` 判断要不要跑跑马灯，标记插在标题里把这 21px 也算进溢出量，悬停/点击时 `placeTitle()` 会把标题滚出裁切框，看起来就是标题没了。
- 位置仍按标题最后一个字的右缘计算（`--ft-plus-x/--ft-plus-y`），因此「贴在标题末尾」的观感不变，但不再影响标题自身的滚动度量，也不会被 React 重设标题文本时一起清掉。
- Fixes the disappearing session title: the marker is no longer inside the title span (which DSH measures for its hover marquee), but an absolutely positioned child of the row.

## 0.9.27 — 2026-11-06

- 修复 DSH 0.2.2 升级后的缩进/连线错位：不再用“全局标题 x”（`baseTitleX`）和跨行测量推算缩进，改为**每行首次装饰时**从计算样式读取自身的 `border-inline-start` / `padding-inline-start` / 首列宽度 / 标题间距，一次性缓存。
- 根因：新版侧边栏每个 Workspace 分组带自己的 `--dsh-workspace-indent`，各行基准 x 不同；且折叠分支里的行 rect 为 0，会把基准测量污染成 0/-8px，于是孙级行 `--ft-pad` 被算成 0、标题跑到父级左边、连线 `--ft-rail-x` 变成负数（跑出行外）。
- 深度缩进现在完全是行内确定值：`pad = 该行原始 padding + 16×depth − 4`，`railX = 标题基准 x + 16×(depth−1)`，不再做二次测量修正，隐藏行展开后也直接正确。
- 行定位优先用新版稳定的 `data-row-key="session:<id>"`，类名/层级变化不再影响识别。
- 连线拐角从“10px 上限”改为行高 50%，正好落在标题中线（新版行固定 32px、单行标题）。
- Fixes broken fork indentation/rails after the DSH 0.2.2 upgrade: per-row, style-derived baseline instead of a global measured `baseTitleX`; rows are found through `data-row-key`.

## 0.9.26 — 2026-11-03

- 新增 `pinFooters()`：识别「收起/展开/显示更多」控件并钉到其含会话祖先的末尾（`order: 999999`，容器必要时转 flex column），确保「收起」永远在会话最底部。
- 归档 OpenSpec 变更 `2026-11-03-pin-collapse-footer`，规格新增「收起控件位于会话之后」需求。
- Collapse controls are pinned after every session row of their group.
## 0.9.24 — 2026-11-03

- 横线长度改为**固定 10px（所有层级，含第 1 层）**，不再随父间距推导；标题由同一处代码左移 `shift`，实测 `aligned=2px`。
- 缩进 16px/层，封顶 5 层；新增缩进修正回环，抵消 DSH 自身内边距。
- 引入 OpenSpec 规格与闸门（`openspec/specs/sidebar-fork-tree/spec.md`、`tools/check-fork-tree.py`）。
- Fixed 10px rail at every depth; the title shift is produced by the same code path.
## 0.9.14 — 2026-11-03

- 修复 DSH 升级后父子乱序：列表容器改为 block 布局后 `order` 失效。现在运行期自适应——容器是 flex 就直接设 `order`，是 block 就一次性转为 flex column，并把非会话子节点钉回原槽位，再按树序分配 `order`；全程不移动 React 节点，不依赖 DSH 的 DOM 结构细节。
- Fixes scrambled parent/child rows after the DSH upgrade (block-layout lists ignored `order`).

## 0.9.8 — 2026-11-02

- 标记按钮与标题最后一个字之间再右移 2px（间距 7px）。
- 2px more gap between the marker and the last title character (7px).

## 0.9.7 — 2026-11-02

- 标记按钮垂直居中改为测量校正（修掉 `!important` 锁死 `position/top` 的问题）。
- 按钮与标题之间留 5px（右侧移 2px）。
- Marker centring is measured; 5px gap to the title.

## 0.9.6 — 2026-11-02

- +/− 垂直居中（按测量校正，不再贴文字底部）。
- 性能：移除全局 body MutationObserver 与 20s 全表轮询；改为侧栏范围内的懒加载观察者，轮询在页面隐藏时暂停，隐藏行跳过几何测量，可见性切换不再重复写属性。
- Vertical centring for the marker; removes the global observer and periodic full sweeps, pauses polling on hidden pages.

## 0.9.5 — 2026-11-02

- 修复 0.9.4 的回归：删除“按标题推导父子关系”的兜底（它会把树倒置，导致点击后全部平铺展开、反复重排）。
- 重排前先比较现有顺序，一致就跳过（消除每次轮询都重排导致的“循环刷新”）。
- 每行只保留一个标记按钮，样式改为标题后的行内按钮。
- Fixes the 0.9.4 regression; removes the name-derived fallback and skips redundant reordering.

## 0.9.4 — 2026-11-02

- 去掉行右端的按钮：每行只保留一个按钮，并清理旧版本残留的 `.ft-toggle`。
- 按钮紧跟标题最后一个字之后（插入到标题最深层文本元素内），会话行与标题行垂直居中。
- Marker rides the last title character, duplicates are removed, rows are vertically centred.

## 0.9.3 — 2026-11-02

- 恢复 0.9.1 的按钮行为（标题后内联、展开显示绿框 −）；不追加“标题截断时固定按钮”的额外规则。
- Restores the 0.9.1 toggle behaviour; no extra truncation rule is added.

## 0.9.2 — 2026-11-02

- 回退 0.9.1 的按钮改动（撤销内联规则），行为回到 0.9.0。
- Reverts the 0.9.1 toggle change; behaviour is back to 0.9.0.

## 0.9.1 — 2026-11-02

- `+` 改为**标题文本后的行内按钮**（不再绝对定位到行右端），不会被会话的默认悬停按钮（归档/置顶）遮挡；展开态显示为带绿框的 `−`。
- The `+` is an inline button right after the title text (no longer pinned to the row's right edge), so the row's hover actions cannot cover it; the open state renders a green-framed `−`.

## 0.9.0 — 2026-10-30

- 彻底修复“无 +、无 ╰”：客户端改为三层取数——注入的 base、`window.__DSH_BOOT__`、页面已发生的 Host 请求 origin（性能条目），逐层尝试。
- 数据完全取不到时启用**名称派生树**：按标题前缀（`父名 · 分叉N` 或系统默认 `父名 (n)`）在本地推导父子关系，仍能渲染缩进、`╰`、`+`、折叠。
- Three-layer Host discovery (injected base → `__DSH_BOOT__` → origin of existing Host requests) plus a name-derived tree fallback, so the UI renders even with zero Host data.

## 0.8.6 — 2026-10-29

- 跨平台取数：宿主把 `window.__DSH_FORK_TREE__`（含 base URL 与谱系快照）注入页面；客户端优先用该 base 请求 `/fork-tree/*`，并在所有请求失败时用快照渲染。
- 所有路由支持 CORS 预检与 `access-control-allow-origin: *`，自定义 scheme / 跨 origin 页面也能取数。
- Cross-platform data access: the Host injects `window.__DSH_FORK_TREE__` (base URL + lineage snapshot); the Client uses it and still renders when fetches are blocked.
- All routes answer CORS preflight with `access-control-allow-origin: *`.

## 0.8.5 — 2026-10-29

- 激活保护：`apply` 外层加 try/catch，插件内部任何异常都不再阻断 DSH 启动（记一条 warn，插件置为未激活）。
- Activation guard: `apply` is wrapped in try/catch, so no internal error can block the DSH boot.

## 0.8.4 — 2026-10-29

- 修复 Linux / 非 desktop profile 启动失败：宿主半不再硬依赖 `workspaceRegistry` / `workspaceController`，缺失时只跳过"顺序持久化"，不影响插件激活与 DSH 启动。
- 修复公开包的客户端模块 id：改为包名 `dsh-session-fork-tree`（之前沿用本地别名 `@local/fork-tree`，DSH 按包名匹配客户端模块，id 不符会导致激活失败、启动报错）。
- Fix startup failure on Linux / profiles without workspace services: the host half no longer hard-depends on `workspaceRegistry` / `workspaceController`; reordering is skipped when they are absent.
- Fix the public package's client module id: it must equal the package name (`dsh-session-fork-tree`), otherwise the client entry fails to activate and DSH refuses to boot.

## 0.8.3 — 2026-10-29

- `+` 按钮改为绝对定位：贴在标题行右端、垂直居中，不再影响标题文本宽度；展开态仍是绿色边框。
- The `+` toggle is absolutely positioned at the right edge of the title line and vertically centred, so it never shifts the title text.

## 0.8.2 — 2026-10-29

- `╰` 上段高度上限从 14px 收紧到 **10px**（多行标题下更短、更轻）。
- The upper segment cap tightens from 14px to **10px**.

## 0.8.1 — 2026-10-29

- `╰` 的上段加高度上限（`max-height: 14px`）：标题换成两行时不再被拉长，横向标题区域也不会被撑高。
- The upper segment of `╰` is capped (`max-height: 14px`) so a wrapped title no longer stretches it.

## 0.8.0 — 2026-10-29

- 项目更名：中文「DSH 会话分叉树排列功能」、英文「DSH Session Fork Tree Arrangement」；README 标题、仓库描述、插件显示名同步。
- Renamed to "DSH Session Fork Tree Arrangement" (zh: DSH 会话分叉树排列功能); README title, repository description and plugin display name updated.

## 0.7.8 — 2026-10-29

- 归档的分叉不再产生 `+`：只有"侧栏里真实渲染出来的子会话"才计入分叉数（归档会话仍在谱系里，但不会被当作子分叉）。
- Archived forks no longer produce a `+`: only children actually rendered in the sidebar count as forks.

## 0.7.7 — 2026-10-29

- 自动命名改为"只改仍是系统默认标题的分叉"：`<父名> · 分叉N`（N = 同父子会话按创建顺序的序号）；人工改过的标题不再被覆盖。
- Auto-naming now only renames a fork whose title is still the generated default (`<parent> · forkN`); titles a human changed are never touched.

## 0.7.6 — 2026-10-29

- 移除"每次激活强制改名"的静态列表，改为上面的自动命名。
- Dropped the forced static rename list in favour of auto-naming.

## 0.7.5 — 2026-10-29

- 行首状态位（空闲点 / 转圈 / 时钟）改为状态无关的 CSS 位移，修正空闲态不生效的问题。
- The leading status seat (idle dot / spinner / clock) is shifted by a state-independent CSS rule.

## 0.7.4 — 2026-10-29

- 修正 0.7.3 未生效的问题：状态位不再从"我们自己的槽位单元格"推导，而是从行内定位（`[data-slot=sidebar.session.row.leading]`，退化时取标题前一个兄弟元素）；工作/等待状态切换重渲染后由观察者与巡检重新贴位移。
- Fix the ineffective 0.7.3 shift: the leading seat is now located from the row itself (slot attribute, else the title's previous sibling) instead of from our own cell, and the offset is re-applied after state-driven re-renders.

## 0.7.3 — 2026-10-29

- 子会话的"工作转圈 / 等待输入时钟"图标左移一个汉字宽度，避免与 `╰` 连接线重叠。
- The working spinner and waiting-input clock move one character left on child rows so they no longer overlap the `╰` connector.

## 0.7.2 — 2026-10-29

- 双击 `+` 不再触发重命名手势；收起状态下展开时立即重新测量连接线坐标（不再依赖悬停）。
- A double click on `+` no longer reaches the row's rename gesture; expanding a collapsed parent re-measures the connector immediately.

## 0.7.1 — 2026-10-29

- `+` 始终保持 `+` 字形，展开态只用绿色边框区分。
- The marker keeps the `+` glyph; an open state is shown by the green border only.

## 0.7.0 — 2026-10-29

- 新增折叠：默认收起，绿色 `+` 展开/收起，逐层递归，展开态绿色边框。
- Collapsible tree: collapsed by default, green `+` toggles per level, green border when open.

## 0.6.4 — 2026-10-29

- 实时化：新会话挂载即拉取谱系、`MutationObserver` 120ms 内重排，不再等 30s 轮询。
- Real-time: lineage is refetched on mount of an unknown session and the order is corrected ~120 ms after DOM changes.

## 0.6.3 — 2026-10-29

- `╰` 改为单一元素绘制（去掉整行竖线）；竖线起点对齐父标题左缘；坐标随窗口变化重算。
- The connector is one shape (no full-height bar), starts at the parent title's left edge, and is recomputed on resize.

## 0.6.0 — 2026-10-29

- 通用排序：按父链先序排到父会话下方，支持任意工作区。
- Generic ordering: pre-order DFS places forks under their parent in any workspace.

## 0.5.0 — 2026-10-29

- 连接线从槽位单元格改为行伪元素，避免被 16px 单元格裁剪。
- Rails moved from the slot cell to row pseudo-elements so they are not clipped.

## 0.2.0 — 2026-10-29

- 拆分 Host / Client 两半：谱系接口 + 客户端渲染。
- Split into Host and Client halves: lineage endpoint plus client rendering.

## 0.1.0 — 2026-10-29

- 首版：配置驱动的会话改名。
- First version: config-driven session renames.
