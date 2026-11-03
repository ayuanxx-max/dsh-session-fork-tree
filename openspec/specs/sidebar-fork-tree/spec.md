# sidebar-fork-tree Specification

## Purpose
TBD - created by archiving change fix-fork-rail-geometry. Update Purpose after archive.

## Requirements

### Requirement: 横线长度固定
分叉连接线 `╰` 的横向段长度在所有层级 SHALL 固定为 10px，
会话标题起点 SHALL 位于横线末端 2px 以内。

#### Scenario: 第一层展开
- **WHEN** 父会话下渲染一个分叉子行
- **THEN** `--ft-elbow-w` 为 `10px`，且 `titleX - (railX + elbowW) ≤ 2`

#### Scenario: 第二层及更深
- **WHEN** 分叉的子会话再次分叉
- **THEN** 横线段仍为 `10px`，标题通过 `--ft-shift` 左移保证紧贴横线

### Requirement: 缩进步长
每一层缩进 SHALL 为 16px，最多 5 层；更深层级不再加宽。

#### Scenario: 深层嵌套
- **WHEN** 层级大于 5
- **THEN** 缩进保持 5 层宽度，标题不被挤出侧栏

### Requirement: 标记按钮
`+` / `−` SHALL 位于标题最后一个字之后 7px，并在行内垂直居中（偏差 ≤1px）。

#### Scenario: 悬停行
- **WHEN** 鼠标悬停出现归档/置顶按钮
- **THEN** `+` / `−` 仍完整可见、可点击

### Requirement: 排序与原生功能兼容
父行顺序号 SHALL 小于其子行；工作区标题 SHALL 位于本组会话之前；「收起」SHALL 位于本组会话之后；
实现 SHALL 只使用 CSS `order`，不得移动 React 节点的 DOM 位置。

#### Scenario: 展开后顺序
- **WHEN** 展开任一父会话
- **THEN** 子行紧随父行之后，且其后不再出现「收起」按钮之前的会话行
