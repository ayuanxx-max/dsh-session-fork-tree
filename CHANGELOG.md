# Changelog · 更新记录

All notable changes to **DSH 会话分叉树排列 / DSH Session Fork Tree**.

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
