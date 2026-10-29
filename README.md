# DSH 会话分叉树排列功能 · DSH Session Fork Tree Arrangement

【DSH 会话分叉树排列功能】把 DSH 侧栏里"另起一行"的分叉会话，变成挂在父会话下面的树：缩进 + 圆角连接线 + 绿色 `+` 折叠按钮 + 悬停祖先链高亮。

DSH Session Fork Tree Arrangement turns forked sessions that used to appear as unrelated rows into a tree under their parent: indent, rounded connector, a green `+` expander, and ancestor-chain highlighting on hover.

[中文](#中文) · [English](#english)

---

## 中文

### 它解决什么问题

DSH 里"分叉"会新建一个会话，但它和父会话在侧栏里是**两条互不相干的平行行**，而且按最近活动排序，新分叉总是跳到最前面。会话一多，就分不清谁是谁的分支。

本插件把父子关系重新可视化：

1. **归属**：子会话紧跟父会话，可配置把顺序写回 `workspace.sessionIds`（持久化）；
2. **缩进 + 连接线**：子行缩进 16px，父标题左缘起画 `╰`（竖线到行高一半后转横线，圆角 8px，绝对像素，窗口变化自动重算）；
3. **折叠**：有分叉的会话，名字右侧会出现醒目的**绿色 `+`**；默认全部收起，点 `+` 展开、再点收起，逐层递归；展开时 `+` 显示**绿色边框**；
4. **悬停高亮**：鼠标划过子行，整条祖先链变亮；
5. **自动命名**：分叉的标题如果还是系统默认（`父名 (1)`），会被改成 `父名 · 分叉N`（N 为同父分叉的创建顺序）；**你手动改过的标题不会被覆盖**。

### 安装

前置：DSH 桌面版或 `dsh web`，一个可用的 profile（默认 `desktop`）。

```powershell
# 1. 取代码
git clone https://github.com/ayuanxx-max/dsh-session-fork-tree.git
$repo = "<克隆目录的绝对路径>"

# 2. 作为本地包登记到 profile
dsh plugin --profile desktop add link:$repo

# 3. 让它成为一个 bundle：在 profile 的 dsh.profile.bundles 里追加
#    %USERPROFILE%\.dsh\profiles\desktop\package.json
#      "dsh": { "profile": { "bundles": [ … , "dsh-session-fork-tree" ] } }

# 4. 完全退出 DSH 再启动
```

> 顺序：先 `dsh plugin add`（装依赖），再改 `bundles`（声明组合），最后重启。只做前者插件不会加载；只做后者会因为包不存在而启动失败。

### 使用

- 打开侧栏：分叉会自动缩进到父会话下面；
- 有分叉的会话，名字右边出现绿色 `+`（默认收起）；
- 点 `+` 展开，按钮变为绿色边框；再点收起；
- 分叉自己还有分叉时，会再出现一层 `+`，逐层展开；
- 鼠标悬停在子行上，父行与祖先链同时变亮；
- 刷新页面/重启后回到"全部收起"。

### 可选配置

在 profile 的 `cordis.patch.yml` 里覆盖该 bundle 的 `config`（升级不丢）：

```yaml
- id: fork-tree
  name: 'dsh-session-fork-tree'
  config:
    renames:                      # 同名分叉改名
      - sessionId: session-…
        title: '父会话 · 分叉1'
    reorder:                      # 把"子会话紧跟父会话"写进 sessionIds
      - sessionId: session-…
        afterSessionId: session-…
```

不配置也能用：客户端会在渲染层按父链排序；`reorder` 只是把顺序持久化，避免下次渲染回退。

### 工作原理

| 层 | 做什么 |
| --- | --- |
| Host 半 | 从 `sessionController.list()` 读 `SessionSummary.parentSessionId` 生成谱系；提供 `GET /fork-tree/lineage.json`（谱系）、`GET /fork-tree/style.css`（样式，客户端每 15 秒重取，**改样式无需重启**）、`POST /fork-tree/report`（客户端自报，落盘 `%TEMP%\fork-tree-report.json`）；可选执行改名与 `insertSessionBefore` 重排 |
| Client 半 | 注册官方槽位 `sidebar.session.row.leading` 与 `sidebar.workspaces.session.row.action` 拿到 `sessionId`；按父链先序排序；用行伪元素画 `╰`；在标题后插入 `+` 按钮；`MutationObserver` 监听新增行，新建分叉 0.2–0.5 秒内归位 |
| 数据 | 只用官方 API（`sessionController`、`workspaceController`），**不改 `app.asar`**、不改核心渲染器 |

### 诊断

- 页面 Console：`__ftReport()` → 返回当前行、缩进、连接线坐标、折叠状态；
- 自报文件：`%TEMP%\fork-tree-report.json`（含 `live`、`hidden`、`toggle`、`children` 等字段）；
- 结构认不出时插件不动作，只在 Console `warn`。

### 已知限制

- 依赖 DSH 侧栏内部结构（行元素的类名/层级）与 `SessionSummary.parentSessionId`，属非公开契约，上游改版可能失效；失效时静默不动；
- 折叠状态存在内存中，刷新后复位（如需记忆可提 issue）；
- 行顺序在渲染层纠正，极少数情况下可能与宿主下一次重排"抢一次"，`MutationObserver` 会再纠正；
- 只覆盖当前可见（已挂载）的会话行。

### 卸载

1. 从 profile `dsh.profile.bundles` 移除 `dsh-session-fork-tree`；
2. `dsh plugin --profile desktop remove dsh-session-fork-tree`；
3. 重启 DSH。

### 许可

MIT，见 [LICENSE](LICENSE)。

---

## English

### What it solves

Forking a session in DSH creates a new session, but the sidebar shows it as an **unrelated row**, sorted by recent activity — new forks jump to the top. With enough sessions, you lose track of which row belongs to which branch.

This plugin re-visualises the parent/child relation:

1. **Ownership** — a fork sits directly under its parent; optional config can persist that order into `workspace.sessionIds`;
2. **Indent + connector** — child rows indent 16px and draw `╰` from the parent title's left edge (vertical down to half the row, then horizontal, 8px rounded corner, absolute pixels recomputed on resize);
3. **Collapse** — any session that owns forks gets a green `+` right of its name; everything is collapsed by default, click to expand, click again to collapse, recursively; an open `+` shows a green border;
4. **Hover highlight** — hovering a child brightens its whole ancestor chain;
5. **Auto naming** — a fork whose title is still the generated default (`Parent (1)`) becomes `Parent · forkN`; titles you renamed yourself are never overwritten.

### Install

Requires DSH Desktop or `dsh web` with a working profile (default `desktop`).

```powershell
git clone https://github.com/ayuanxx-max/dsh-session-fork-tree.git
$repo = "<absolute path of the clone>"

dsh plugin --profile desktop add link:$repo

# then append "dsh-session-fork-tree" to dsh.profile.bundles in
#   %USERPROFILE%\.dsh\profiles\desktop\package.json

# quit DSH completely and start it again
```

> Order matters: install the dependency first, declare it in `bundles` second, restart last.

### Usage

- Open the sidebar — forks indent under their parent automatically;
- A session with forks shows a green `+` (collapsed by default);
- Click `+` to expand (button gains a green border), click again to collapse;
- A fork that owns forks gets its own `+`, layer by layer;
- Hover a child row — its ancestors brighten;
- Reloading returns to "all collapsed".

### Optional config

Override the bundle's `config` in the profile's `cordis.patch.yml`:

```yaml
- id: fork-tree
  name: 'dsh-session-fork-tree'
  config:
    renames:
      - sessionId: session-…
        title: 'Parent · fork 1'
    reorder:
      - sessionId: session-…
        afterSessionId: session-…
```

### How it works

| Layer | Role |
| --- | --- |
| Host | Reads `SessionSummary.parentSessionId` from `sessionController.list()`; serves `GET /fork-tree/lineage.json`, `GET /fork-tree/style.css` (refetched every 15 s — **style changes need no restart**), `POST /fork-tree/report` (writes `%TEMP%\fork-tree-report.json`); optional rename and `insertSessionBefore` reordering |
| Client | Registers the official slots `sidebar.session.row.leading` / `sidebar.workspaces.session.row.action` for the row's `sessionId`; orders rows as a tree; draws `╰` with row pseudo-elements; inserts the `+` button next to the title; a `MutationObserver` places a fresh fork within 0.2–0.5 s |
| Data | Official APIs only (`sessionController`, `workspaceController`); never patches `app.asar` |

### Diagnostics

- Console: `__ftReport()` → rows, indent, connector coordinates, collapse state;
- Report file: `%TEMP%\fork-tree-report.json`;
- Fails safe: unknown structure means no action and a single `warn`.

### Limitations

- Depends on the sidebar's internal markup and on `SessionSummary.parentSessionId` (a private contract); a redesign can break it, in which case it silently stops;
- Collapse state is in memory and resets on reload;
- Row order is corrected in the render layer; the `MutationObserver` re-corrects if the host re-sorts;
- Only mounted (visible) rows are handled.

### Uninstall

Remove `dsh-session-fork-tree` from `dsh.profile.bundles`, run `dsh plugin --profile desktop remove dsh-session-fork-tree`, restart DSH.

### License

MIT, see [LICENSE](LICENSE).
