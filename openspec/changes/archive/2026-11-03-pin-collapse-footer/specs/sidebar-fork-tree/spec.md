# sidebar-fork-tree 规格增量

## ADDED Requirements

### Requirement: 收起控件位于会话之后
任何分组内的「收起」控件 SHALL 渲染在该组所有会话行之后。

#### Scenario: 展开多个会话后
- **WHEN** 组内有展开的分叉子行
- **THEN** 「收起」在所有会话行下方，其后不得再出现会话行

#### Scenario: 控件识别
- **WHEN** 控件文本为「收起」「展开」「显示更多」「显示更少」（或英文 Show more/less）
- **THEN** 该控件被钉到组末，且其容器转为 flex column（若原本不是 flex）
