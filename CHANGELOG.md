# Changelog · 更新记录

All notable changes to **DSH 会话分叉树排列 / DSH Session Fork Tree**.

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
