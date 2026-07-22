# CP 跳动桌宠开源调研与 MVP 方案

> 调研基线：2026-07-21。这里只借鉴窗口、拖拽与行为编排方式，没有复制第三方角色图片、Live2D 模型或行为配置。

## 可借鉴项目

| 项目 | 许可 | 可复用经验 | 不直接采用的部分 |
| --- | --- | --- | --- |
| [OpenPets](https://github.com/alvinunreal/openpets) | MIT | 透明无边框小宠物窗口；页面默认 `pointer-events: none`、仅宠物命中区恢复交互；主进程掌握拖拽和窗口坐标；共享运动 ticker；macOS/Windows 鼠标转发看门狗会在 reload、睡眠或全屏切换后重新武装穿透 | OpenPets 的托盘、单宠物窗口和本地运动引擎不替代 CP 跳动现有 Character Agent、关系裁判、记忆与多角色相对空间；本轮只适配命中、穿透恢复和移动收敛机制 |
| [BongoCat Next](https://github.com/liwenka1/bongo-cat-next) | MIT | Tauri 2 的透明无边框窗口、`skipTaskbar`、点击穿透、原生拖拽、托盘与多窗口边界；前端同样使用 Next/React | 当前仓库没有 Rust 工具链；Live2D、键盘监听和模型资源不属于 CP 跳动的像素资产协议 |
| [Shimeji-Desktop](https://github.com/DalekCraft2/Shimeji-Desktop) | New BSD；原 Shimeji 为 zlib/libpng | 把 `Dragged / Thrown / ChaseMouse` 作为行为事件，而不是单纯坐标变化；行为与动作资源分开配置 | Java/AWT 运行时与 XML 行为系统会复制现有 Character Agent/Interaction Runtime，不能直接并入 |
| [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) | Electron 项目许可 | 透明、无边框、置顶窗口，`setIgnoreMouseEvents(..., { forward: true })` 在 macOS/Windows 上实现桌面穿透与角色命中切换 | Linux 的鼠标转发和窗口系统差异较大，MVP 不声称已完整支持 |
| [Electron screen](https://www.electronjs.org/docs/latest/api/screen) | Electron 项目许可 | 使用工作区坐标和 DIP 处理不同缩放比例；后续可用 `getAllDisplays()` 扩展多显示器 | MVP 先绑定主显示器工作区 |

另检查了 Electron 桌宠 Bonk 的“主窗口 + 透明宠物窗口 + preload IPC”分层。其仓库未发现明确许可文件，因此只把公开架构描述作为对照，不复制源码。

## 选择 Electron 的原因

当前工程已经是 Node 22、TypeScript、React 和服务端 Worker。Electron 可以用很薄的本地表层复用现有状态与 Sprite Sheet 协议，同时把高权限逻辑留在网页 owner 会话：

- 网页中的 Character Agent 独立调用与隐私上下文；
- 网页中的 `GameState`、Interaction Runtime、Relationship Judge 和 Memory Runtime；
- `PixelPetSprite` 使用的已有 Sprite Sheet 与 append-only 动作包协议；
- 浏览器原有 `/api/ai/agent` 与 `/api/saves` 边界，Electron 不直接持有这些权限。

Tauri 的体积更小，适合后续发布阶段重新评估；当前机器没有 Rust 工具链，首版引入它会同时改动构建系统和桌宠功能，验证面过大。

## MVP 架构

```text
网页自然世界
  → POST 127.0.0.1:47831/v1/handoff
  → Electron 本地透明表层（不加载 Sites、不读取浏览器 Cookie）
  → 网页舞台和角色卡不再重复渲染角色形象
  → 拖拽/点击动作排入受限的本机环回队列
  → 原网页 owner 会话运行 reducer、Character Agent 与关系裁判
  → 权威状态发布回本地表层
  → preload 只暴露状态、受限动作、命中探测、穿透和停止能力
  → 同一 reducer + Character Agent 在桌面继续运行
  → 只有玩家点击“保存世界”才用原会话写回 /api/saves
```

本机桥只监听 `127.0.0.1`，不写磁盘、不记录角色内容，并校验固定协议、请求头、来源白名单、1–3 人自然世界和 24 MB 上限。Electron 只加载随伴侣分发的本地表层，不能导航到远程域，也不能访问 Node API；preload 只暴露读取公开状态、提交受限指针动作、鼠标穿透和停止四类能力。Character Agent、关系裁判和后端写入继续留在已登录的网页 owner 会话。

## 拖拽与角色反应

拖拽分为 `move` 和 `drop`：

1. `move` 只实时更新被拖角色的桌面坐标和公开朝向，不写关系，也不运行互斥修正；鼠标经过其他角色时允许暂时遮挡，其他角色不会被连续推走。
2. `drop` 才执行一次带固定拖拽落点的重叠检查并计算所有角色的新距离，产生“玩家移动了角色”的公开 L1 事件。桌宠允许占用盒遮挡，只在重叠面积超过 50% 时把发生过度重叠的其他角色轻微移到约 50% 重叠率，并用 360ms 过渡柔和移动。后续自主移动从该落点相对起步。距离分级以角色当前可视身体宽度为单位：0.5 个身体净空隙为接近，1 个为正常，2 个起为远离。
3. 每个受影响角色进入 `desktopAttentionQueue`，由自己的 Character Agent 逐个决定吃惊、观察、呼唤、沉默、靠近、离开或继续原本行为。
4. Relationship Judge 只在后续真实可见回应发生后分别处理 A→B 与 B→A；玩家拖拽本身不改好感或信任。

点击只生成不入卷轴的短暂触发，角色仍可回应、沉默或继续原动作。短暂回应不推进世界回合、不写关系、卷轴或长期记忆；若 Character Agent 决定移动、发起需要另一角色回应的互动，则按真实位置/角色互动事件进入卷轴。透明层不再显示常驻控制条或状态通知，页面默认完全穿透，只在角色命中区接管鼠标；主进程每 750ms 探测鼠标并重新武装 macOS/Windows 转发，避免切换页面、睡眠或全屏后透明层意外挡住其他应用。

桌宠转移不是保存动作。桌面期间的角色状态只存在于当前网页 owner 会话和 Electron 内存快照；玩家点击网页上的“保存世界”后，世界、角色与记忆才会提交到后端。收回网页只 hydrate 最后快照，不隐式保存。

## 当前边界

- 已实现 macOS/Windows 主显示器透明桌宠；Linux 和多显示器是下一阶段。
- 浏览器标签页需要保持打开，原 owner 会话才会消费桌面动作、调用 Character Agent 并发布画面；只有点击“保存世界”才会持久化。标签页关闭后桌宠只保留最后同步画面，退出应用会丢失未保存进度。
- 尚未打包签名 `.dmg/.exe`，当前通过 `npm run desktop:dev` 启动伴侣。
- 桌宠仍是自然模式；不引入导演模式、固定剧情或统一双人 Agent。
