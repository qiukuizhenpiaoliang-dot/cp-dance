# CP 跳动 / Couple DANCE 双模式 Agent 架构

> 当前基线：2026-07-21。自然模式与导演模式在进入世界前选择，进入后互相独立且不可切换；两者共享角色自主互动、同意、关系和记忆内核。项目运行与接手说明见 [PROJECT_HANDOFF.md](./PROJECT_HANDOFF.md)。

## 1. 系统目标

玩家先创建 1–3 名角色，并在同一页面完成动作角色制作；随后在互动预览中填写双向关系，再选择进入持续运行的自然世界或导演剧场。两种模式中，角色都依据自己的人格、情绪、目标、记忆、关系理解和当前可见信息，自主完成一个个小动作。

系统不预写完整剧情，不通过好感阈值控制角色，也不允许一个模型一次写完所有人的行为。单角色可以探索、观察和休息；多角色世界每轮先唤醒一个局部焦点，公开发言可指向一人、选定多人或全场，每个接收者再由自己的 Agent 独立选择回应、观察、沉默或退出。身体接触和同步动作仍一次只处理一对角色。

产品入口固定为：

```text
角色建档＋制作可交互角色 → 互动预览＋绑定双向关系网 → 选择自然模式 / 导演模式 → 进入世界后锁定模式
```

## 2. 总体分工

| 模块 | 决定什么 | 不能做什么 |
| --- | --- | --- |
| Attention Scheduler / Orchestrator | 根据待回答问题、连续公开对话、距离、行动间隔和未完成事项选择本轮唤醒谁，组装其有权读取的上下文、路由公开行为、查询动作资产 | 替角色决定动作、说话或亲密结果；泄露另一角色私密信息 |
| Director Agent | 仅在导演模式中规划 Plot Beats、评估公开证据、提出场景和公开世界事件 | 扮演角色、生成角色台词或主动动作、读取私有记忆、修改关系数值、决定角色同意或结局选择 |
| Story Context Compactor | 仅按 Story Orchestrator 请求压缩已经公开且已经发生的剧情，输出带 sourceEventIds 的稳定摘要 | 续写剧情、推断私密想法或关系、判定未由 Runtime 完成的条件、删除或改写原始事件 |
| Story Runtime / Orchestrator | 校验导演输出，把合法提议提交为公开事件、场景、实体和状态，再逐个唤醒可见角色 | 把隐藏大纲、结局目标或导演理由发送给 Character Agent；绕过 Interaction Runtime |
| Character Agent | 只决定自己的移动、朝向、语言、沉默、表情、请求、接受、拒绝、退出和私人记忆 | 控制另一角色；直接写关系数值；一次生成完整故事 |
| Character Research Skill | 在玩家主动点击后搜索 Wikipedia/Wikidata 与萌娘百科；排除消歧义和非人物页，必要时只纠正角色别名后重搜；由玩家确认 1–3 个来源，读取整页可见正文并按段覆盖全文提炼，生成可编辑且默认未确认的多源草稿，再与玩家资料蒸馏为可编辑的最终 Profile 预览；只有玩家应用预览后进入角色上下文 | 自动搜索、只读开头摘要、让别名模型生成事实、自动确认模型草稿、保存未确认内容、覆盖玩家资料、未经预览直接写档、丢失萌娘百科署名/原页链接/非商业许可、把原作关系当成当前感受、自动镜像反向关系 |
| Interaction Runtime | 校验动作、请求—回应和边界，执行相对空间变化，产生公开事件 | 决定角色意愿；把物理靠近当成情感同意 |
| Relationship Judge | 根据已经发生的可见结果分别更新 A→B 与 B→A | 接受模型直接写入好感、信任或关系阶段 |
| Character Asset Agent + Asset Index | 复用、组合或生成缺失动作，校验后登记为 ready | 决定角色何时使用资产；生成完成后强迫角色继续旧动作 |
| Background Asset Agent + Catalog | 按公开场景描述查询背景总索引、把复用结果登记到对应世界；无合适资产时生成并持久化新背景 | 控制角色、改关系、读取私有记忆、让 Director 直接接触图像通道或写入资产索引 |
| Memory Runtime | 检索该角色自己的相关文档，校验记忆提案、证据和 revision，再分别提交 | 把一名角色的私人记忆交给另一名角色；让模型直接覆盖文档 |

角色私有记忆以 `owner + world + agent` 为边界：世界存档持有在该世界形成的 revision、回调线索与未完成问题，重新进入同一世界时恢复；独立角色存档只携带 Character Profile、Reference Pack 与视觉资产，加入另一世界时不得带入旧世界经历。
| Desktop Bridge / Surface | 把自然世界接力到透明桌面层，把点击、拖拽和距离变化写成公开环境事件，并把状态交回原网页后端会话 | 接受导演模式；复制一套关系内核；把玩家拖拽当成角色意愿；把桌面坐标直接写成好感或固定情绪 |

当前原型中，调度、Story Runtime、执行、关系裁判和记忆提交位于 `lib/agent-engine.ts`；导演领域层位于 `lib/director-types.ts` 与 `lib/director-runtime.ts`，导演上下文预算、摘要 revision 与恢复规则位于 `lib/story-context.ts`。真实角色模型由 `/api/ai/agent` 调用；Director 与按需 Compactor 共用 `/api/ai/director` 和同一服务端文本通道，但使用互相独立的权限提示与任务契约。

## 3. 每轮运行链路

```text
读取全局状态
  → 注意力调度器为所有 actor → counterpart 候选计算机会优先级
  → 优先处理待回答问题、连续对话、近距离对象和未完成事项
  → 组装 Character Profile v2 / 玩家采用的 Character Reference Pack / Relationship Lens / Stage / Message History / Public Dialogue / Group Scene
  → POST /api/ai/agent（PERCEIVE_AND_DECIDE）
  → 角色只返回自己的一个动作
  → 保存逐字公开台词、非语言动作、话题和待回答问题
  → 明确同意请求只路由给一个对象；多人公开问题可分别路由给最多两名接收者；观察、沉默等只形成公开事件
  → 为每名接收者分别 POST /api/ai/agent（RESPOND_TO_SPEECH 或 RESPOND_TO_INTERACTION_REQUEST）
  → 查询双方动作资产
  → 缺失时异步调用 Character Asset Agent，并立即准备基础回退动作
  → Interaction Runtime 校验同意与拒绝
  → 建立 cp-dance/interaction-session/v1
  → 转向 → 正常接近 → 骨骼细对齐 → 五个关键阶段 → 恢复自主
  → Relationship Judge 根据可见结果分别结算两条方向关系
  → Memory Runtime 校验 baseRevisionId、已读 revision 和事件证据
  → 写入公开事件、双方各自的版本化方向记忆、角色感回调线索、阶段历史、公开对话和相对空间状态
```

导演模式在同一角色链路之前增加一层公开世界编排：

```text
玩家故事设定 / 剧情方向
  → Story Orchestrator 检查公开事件预算与语义边界
  → 必要时调用 Story Context Compactor，并由本地校验 source/base/coverage/置顶事实
  → POST /api/ai/director
  → Director Agent 提出大纲、节拍、公开事件或场景变化
  → Story Runtime 校验字段、角色可见范围与场景切换条件
  → 提交公开世界事实并写入卷轴
  → Background Asset Agent 查询 cp-dance/background-catalog/v1，复用已有背景并更新 cp-dance/background-world-index/v1
  → 无合适匹配时自动生成；成功后写入对象存储并同步更新总索引与世界索引，失败时保留安全预设场景
  → 为每名能看见该事实的角色建立独立注意力任务
  → 回到相同的 Character Agent → Interaction Runtime → Relationship Judge → Memory Runtime 链路
```

普通剧情评估至少间隔 4 个角色回合，除非玩家提交新的剧情方向。玩家输入由确定性分类器分为“强制世界事实 / 剧情指导 / 场景请求”，但仍必须经过 Director Agent 与 Story Runtime，不能直接写角色动作。故事结束只停止导演继续编排，不覆盖已经形成的关系、位置、台词或记忆。`sceneProposal` 先映射安全场景语义，再由独立 Background Asset Agent 从总索引复用已有背景；无合适匹配时由该资产 Agent 自动生成、持久化并登记，Director 本身仍无权访问图像密钥或写资产索引。

Character Agent 在导演模式只额外读取 `sceneBrief / visibleWorldEvents / visibleEntities / publicCharacterStatuses / environmentAffordances`。`currentBeat`、完整大纲、隐藏结局目标、`runtimeReason` 和导演内部状态永远不进入角色上下文。

### 3.1 导演上下文压缩

- `storyPublicEvents` 是按时间追加的公开事实源，不裁剪、不被摘要覆盖；卷轴展示与审计始终以原始事件为准。
- 未压缩尾部达到约 6000 tokens 或 24 KB 后，在安全回合请求压缩；达到 8000 tokens 或 32 KB 后，Director 与大纲重排保持阻断，直到本地验证通过一版摘要。
- 场景切换、Plot Beat 完成、重排大纲前和旧导演存档恢复都强制压缩；保留最近最多 12 个公开节拍且约 1800 tokens 的原始尾部。
- 稳定摘要 schema 为 `cp-dance/story-context-summary/v1`，必须绑定 `revisionId / baseRevisionId / sourceEventIds / coveredThroughEventId`。场景摘要、节拍摘要和稳定故事摘要都是 append-only revision；Director 任务同时绑定 `summaryRevisionId / outlineBaseRevision / coveredThroughEventId`。
- 未回答问题、活跃请求、可见实体/状态、未解线索、pending 玩家指令和 Beat 条件保持结构化置顶，不依赖摘要自由发挥。
- 服务端先移除越权字段、限制真实 source ID 与 Runtime 完成条件；客户端再验证连续覆盖、base revision、输入事件、未回答问题、pending 指令和私有内容。失败时缩小连续范围重试一次，再生成完全由输入拼接的不补写摘要。
- Compactor 只读取公开事件、上版已验证摘要和 Runtime 结构化裁决。它永远不读取 Character Agent 的 `privateThought`、私有记忆、精确方向关系数值或模型思维链。

真实文本 API 失败时，网页表层可以调用旧的确定性自然规则作为明确标记的安全回退。桌宠表层不会用这套规则生成角色台词或动作，而是清空当前触发并暂停自主交互，避免把预设内容误认成 Character Agent 输出。

桌宠模式不建立第二套 Agent 编排，也不存在独立的桌宠 Agent；它只把同一角色转移到桌面表层。`surface` 与 `running` 是正交状态：切换 `web` / `desktop_pet` 不得修改 `running`，自主交互开关在两种表层都由网页控制。网页通过本机 loopback bridge 接力当前内存状态并停止重复渲染角色形象；Electron 只加载本地透明表层，把拖拽/点击作为受限动作排队。只有 `running=true` 时，原网页 owner 会话才继续消费注意力任务并运行各角色自己的 Character Agent、Interaction Runtime 与 Relationship Judge。桌面气泡只接受 `event-agent-*` 的真实逐字输出，并按事件与角色去重、限时显示；入住语、确定性回退和其他系统记录不得成为桌宠台词。桌面拖拽落点形成公开 L1 位置事件；被拖角色和受影响角色都进入 `desktopAttentionQueue`，由各自 Agent 逐个判断吃惊、害羞、脸红、生气、说话、沉默、移动或继续原行动。拖近时害羞/脸红及一句短台词是高权重表现候选，但不覆盖 Character Profile、Relationship Lens、拒绝与离开权，也不把靠近等同于接触同意。缺少合适表情/动作时，仍由该角色自己的 Character Agent 先决定行为并使用当回合语义回退；素材生成服务随后异步生成 `pixel-pet/action-pack/v1` 增量包，只负责视觉资源，不参与裁决。校验成功会写入 `event-asset-ready-*` 系统卷轴记录，但不会自动播放或写关系/长期记忆。轻点触发的无位移 Agent 回应只进入 `desktopTransientReaction`，不推进回合、不写卷轴、关系或长期记忆；实际移动或需要另一角色独立回应时才升级为世界事件。保存必须在 `running=false` 且当前 Agent 回合结束后显式执行；否则 context 只保留在当前会话。

## 4. Character Agent 的角色表演上下文

协议为 `cp-dance/character-context/v6`。每次任务包含：

1. **Character Profile v2**：纯手填时直接来自玩家；启用考据时，由玩家原始资料与玩家确认的公开资料先生成 `cp-dance/character-profile-distillation/v1`，在界面中完整预览、继续编辑并由玩家明确应用后形成。玩家资料优先，蒸馏不能删除或扭曲它；预览前不得写入档案或记忆。
2. **Character Reference Pack v1**：只有玩家主动搜索、确认候选、编辑或勾选并最终应用的公开考据资料；服务端优先读取百科整页 HTML 的可见文字，清理非内容节点后切成最多 12 个、每个约 14000 字的片段逐段提炼，并在来源元数据记录正文模式、字数、章节数、分段数和截断状态。服务端返回的草稿全部 `selectedByPlayer: false`，蒸馏与前端应用都过滤掉所有未确认项。每条保留来源、置信等级、时间点与局限。`inferred` 仅作弱提示。萌娘百科来源还必须保留原页链接、“引自萌娘百科”、`CC BY-NC-SA 3.0 CN` 与不可商用标记。
3. **Relationship Lens**：每个 A→B 各自保存的关系种类、玩家填写的主观看法和共同经历，再叠加当前定性立场、情绪、边界与未完成事项。原作关系事实只能生成待审阅草稿。
4. **Stage 层**：当前任务、注意力调度原因、阶段指令、已知边界与公开 trigger。`turnBrief` 用一句话回答“为何唤醒、正在做什么、未完成目标、距离、待回答问题、上一个自身节拍、何时结束”；`capabilities` 分开列出语义行为、需要请求的行为、本回合禁止行为和现成动画目录。
5. **Message History 层**：该角色自己的动作、逐字语言、非语言节拍、话题、私有反思与公开结果。
6. **Public Dialogue 层**：`cp-dance/public-dialogue/v1` 保存所有参与者的逐字公开台词、动作、言语行为、回应方式、当前话题与待回答问题；不含任何人的私人想法。
7. **Group Scene 层**：`cp-dance/group-scene/v1` 保存最多三名场景参与者、当前发言者、选定对象、公开听众，以及每人正在发言、参与、观察或退出的定性状态。它不是群体关系评分，也不能覆盖任意两人的 Relationship Lens。

v6 同时保留当前身心状态、目标、主观关系理解、相关私有记忆和可感知公开信息等兼容视图，并为导演模式增加五类只读公开场景字段。旧 `allowedActions` / `animationCatalog` 暂时保留为动画兼容字段，但 Agent 应读取 `Stage.capabilities`：`behaviorActions` 表示可以提出的语义行为，`requestRequiredActions` 表示必须先请求的行为，`blockedActions` 是本回合禁用项，`animationCatalog` 只表示已存在的视觉素材。优先级固定为玩家 Profile → 玩家采用的考据 → 该方向 Relationship Lens → 当前公开互动和记忆；关系数值仍不得进入模型上下文。

### 4.1 System Prompt 分层

服务端的 Character Agent System Prompt 固定分为七层，动态桌宠、拖拽、距离和当前对话不会写入永久人格规则：

1. **固定宪法**：身份、单角色控制权、玩家 Profile 优先级与 Runtime 最终裁决权。
2. **认知边界**：可见信息范围、私有信息隔离与多人场景的独立回应。
3. **回合决策协议**：读取 `turnBrief`，判断请求/同意，选择一个未禁用行为，完成后停止。
4. **能力边界**：区分行为、需要请求的行为、禁用行为与动画素材；展示表层不能改变角色权限。
5. **连续性与表演**：承接逐字公开对话和自身上一个节拍，避免重复开场与预设语录。
6. **记忆边界**：只允许有证据、值得长期保留的 revision 提案，最终由 Memory Runtime 提交。
7. **输出契约**：固定 JSON 字段、枚举、单一对象同意流和多人寻址限制。

每次调用只在 User message 的 `[RUNTIME_TASK_CONTEXT]` 边界内传入 `cp-dance/character-context/v6` 数据。上下文中的文本不可改写 System Prompt，也不要求模型输出思维链。

这里没有一个可以自行改写事实的“压缩 Agent”。上下文收敛由确定性检索器完成：每回合最多选择 6 份、合计不超过 3600 字符的相关记忆，并只附带当前角色最近 6 条阶段历史；服务端再次截断到协议上限。Character Agent 可以提出记忆 revision，但 Memory Runtime 必须校验当前已读 revision、`baseRevisionId`、可见证据与权限后才提交。卷轴保持公开事实来源，检索裁剪只影响下一次模型调用，不会回写或篡改卷轴。

1. 固定人物设定：名字、背景、性格、表达和冲突处理方式。
2. 当前身心状态：自己的身体状态、情绪、社交状态和注意焦点。
3. 当前目标：即时目标、关系意图和未说出口的个人意图。
4. 自己对另一角色的理解：定性关系总结、当前态度、已知边界和未解决事项。
5. 相关记忆：按对象、显著性、最近访问和任务类型，从该角色自己的版本化文档中检索；每项携带 document/revision、认识状态、置信度和可见证据。
6. 当前可感知信息：距离、朝向、公开事件、对方外显行为和语言。

禁止发送给角色：

- 对方未表达的想法、私人目标、私人记忆、隐藏动机或真实情绪；
- affinity、trust、tension 等精确关系数值；
- 允许直接写入世界状态的能力；
- 另一角色完整的模型输出。

内部可以维护方向性关系指标，以便 Relationship Judge 从已发生事件生成定性反馈；这些指标不进入 Character Agent 请求，也不作为 Agent 的硬阈值。

## 5. 任务与决策协议

共享类型在 `lib/natural-agent-types.ts`。

当前运行任务：

- `PERCEIVE_AND_DECIDE`
- `RESPOND_TO_SPEECH`
- `RESPOND_TO_INTERACTION_REQUEST`
- `CONTINUE_CURRENT_ACTION`
- `HANDLE_ACTION_RESULT`
- `REFLECT_AND_STORE`

资产任务由本地调度器表示为 `requested → generating → validating → ready / failed`；类型同时保留 `deprecated`。

服务端会忽略模型自行返回的 actor id，只使用任务的 `assignedTo`。角色表演协议在原动作、语言、私人想法、情绪、互动类型和动画需求之外，增加 `performanceIntent / nonverbalBeat / speechAct / responseMode / topic / addressedTo / addresseeIds / audienceScope / responseExpectation / participationIntent / continueScene / closeReason / roleplayMemory`。`audienceScope` 区分一人、选定多人和全场，`participationIntent` 表达继续、加入、插话、观察、撤回或离开。`performanceIntent` 只是一句短表演意图，不是长推理；服务端从输入上下文中提取实际已读 revision，模型不能自报读取历史。

公开行为分为三类路由：

- **必须回应**：接触、双人动作和敏感话题请求；没有明确同意就不执行。
- **可回应**：明确交给对方的问题、邀请、挑战、坦白或边界表达；可立即唤醒对方，但对方仍能沉默、回避或离开。
- **只观察**：普通观察、发呆、移开视线、独自行动等；不强制调用对方，后续由注意力调度决定是否值得回应。

## 6. 请求—回应与同意

以下动作必须请求并等待目标角色独立回应：

- 拥抱、牵手、亲吻、贴贴、倚靠和拉住；
- 共同播放双人动作；
- 阻止对方离开；
- 进入敏感话题。

接收者可以接受、犹豫、拒绝、提出替代、沉默、移动或结束互动。模型没有返回有效同意时，Interaction Runtime 对接触类请求按拒绝处理。

以下动作可以先执行，再成为对方可感知事件：注视、转身、移动到附近、坐在附近、说话、沉默、改变自己的表情和离开。

角色 A 只能输出“A 做了什么或尝试什么”。“A 抱住 B，B 开心回抱”属于非法输出，因为它越权控制 B。

## 7. 空间模型

角色 Agent 只接收相对空间：

- 距离：`alone / far / near / touching`；
- 朝向：双方当前面向的定性说明；
- 接触：无接触或由已同意互动形成的接触；
- 公开动作：靠近、远离、观察、休息等。

桌宠表面增加 `coordinateSpace: desktop`，允许主显示器工作区中的更大纵向范围，但继续使用相同的 `hypot(dx, dy × 0.62)` 相对距离语义。距离感知与画面碰撞分层：`spatial-occupancy` 根据 `coordinateSpace` 和 `renderScale` 计算可视占用盒。网页舞台仍不允许占用盒重叠；桌宠则允许普通的前后遮挡，只有重叠面积超过较小角色占用面积的 50% 时才触发位置修正。拥抱、抚摸等互动的语义仍可为 `touching`，但细对齐的目标距离不得小于占用盒水平间隙，因此画面只贴边、不穿模。距离分级使用轮廓之间的净空隙而非固定中心点阈值：`near` 为不超过 0.5 个身体宽度，`normal` 覆盖正常的一个身体空隙，达到 2 个身体空隙起为 `far`。拖拽 `move` 不运行占用盒修正，只有被拖角色更新位置；`drop` 才执行一次固定该角色的检查，并只对超过 50% 的重叠轻微移动其他角色，直到重叠率回到约 50%。释放后落点作为新的权威当前位置，`explore` 从该点做有界的相对位移，不再生成绝对随机坐标。桌宠投影回网页/存档时恢复为舞台坐标，不把屏幕像素暴露给 Character Agent。

前端仍保存 `x/y` 百分比用于动画布局，但坐标不进入 Agent 的语义决策。Interaction Runtime 使用与舞台长宽比校正后的距离：普通说话、观察和转向只更新朝向与感知，不会重排两人；距离过远的交谈只转向，不替角色决定靠近；靠近和离开只移动行动者；仅双人动作在明确同意后才可进入细对齐。

物理靠近不等于情感同意，坐标很近也不会自动推导 `touching`。只有完成请求—独立回应—边界检查，角色才会进入 `touching/cuddle`。

每个角色视觉还携带 `cp-dance/interaction-rig/v1`：头、胸、髋、左右手和左右脚共 7 个归一化锚点。新生成角色从 Sprite Sheet 首帧的 alpha 轮廓提取骨骼；旧存档或无法分析的资源会迁移为安全估算骨骼。双人接触执行顺序为：

```text
明确同意
  → orient：按双方实际 x 持续相向
  → approach：每阶段最多移动 5 个舞台单位，检查边界与第三人碰撞
  → align：选择动作关键阶段锚点，校验身高差、置信度与接触残差
  → 在 0.82–1.18 范围内计算缩放，并限制根节点微调在 2–4 个舞台单位
  → 输出 perfect / acceptable / invalid
  → 通过则进入五阶段播放；未通过则降级为 near，不产生 touching
```

校验结果以 `cp-dance/duo-validation/v1` 写入事件，记录接触点、身高差、缩放、残差、告警与最终裁决，便于 UI 展示和事后追踪。它只判断动作是否可稳定呈现，不替代角色同意。

## 8. 双向关系与版本化记忆

每个角色对保存 A→B 与 B→A 两条独立方向。内部方向包含好感、信任、张力、吸引、依恋、尊敬、怨恨、恐惧、嫉妒、承诺意愿、边界、拒绝锁和未解决事项。

每个方向同时保存 `cp-dance/relationship-lens/v1`。Lens 只提供定性的玩家初始设定和角色当前主观理解，不向模型暴露内部关系数字，也不替 Relationship Judge 改写关系结果。

前端只显示“愿意靠近、仍在观察、信任松动、对接触警惕、拒绝仍有效”等定性结果。模型不能返回关系 delta，也不能读取内部数字。

一次互动分别写入：

- 公开事实事件；
- 发起者自己的理解；
- 接收者自己的理解；
- 更新后的公开空间状态；
- Relationship Judge 的可追溯原因。

每名角色的 `AgentMemory` 使用 `cp-dance/character-memory/v1`，包含：

- `general.txt`：自我理解、计划与长期反思；
- `characters/<agent-id>.txt`：该角色对特定人物的方向性理解；
- `topics/<topic>.txt`：其他需要长期追踪的主题；
- append-only revisions：摘要、正文、`observed / inferred / rumor`、置信度、证据事件、回合和 base revision；
- access log：本次调用实际读取和提交了哪些 revision。
- `roleplayCues`：只有具体措辞、承诺、偏好、边界、未完成问题或共同细节值得影响未来表达时才写入，并按对象、显著性和新近度召回。

模型只有提案权。更新已有文档必须满足：目标文档属于当前角色、该调用读取了最新 revision、`baseRevisionId` 等于最新 revision、引用的事件对该角色可见、内容不含内部关系数值。新文档必须使用 `documentId: null` 且不能伪装成已有路径。任何条件失败时提案会被拒绝，Memory Runtime 仅把本回合已经裁决的公开结果作为 `observed` 安全写入，因此不会因模型格式错误丢失连续性，也不会让模型绕过权限。

## 9. 动作资产索引

动作系统分为三个独立层次：Character Agent 的行为意图、Sprite Sheet 的可播放单人动作，以及 Interaction Runtime 的空间/双人编排。行为意图不能直接当作帧索引，双人编排也不等于生成了一张双人合成图。

### 9.1 行为意图与单人动作

Character Agent 可选择的行为意图如下：

| 能力 | 行为意图 |
| --- | --- |
| 单人活动 | `explore / observe / rest / stay` |
| 距离 | `move_closer / move_away` |
| 朝向 | `face_other / look_away` |
| 表达 | `speak / remain_silent / request_conversation` |
| 需同意的请求 | `request_touch / request_shared_action` |
| 结束 | `end_interaction` |
| 独立回应 | `respond_accept / respond_hesitate / respond_reject / respond_counter` |

新角色默认生成的基础动作资产为：

| 动作 | 帧与方向 | 典型用途 |
| --- | --- | --- |
| `idle` | 正面、左前侧转、右前侧转 | 待机、休息、安全回退 |
| `walk` | 左、右两组循环；没有专用正面行走帧 | 探索、靠近、远离、结束互动 |
| `wave` | 正面、左前侧转、右前侧转 | 招呼、预览、普通共同动作组合 |
| `cry` | 正面、左前侧转、右前侧转 | 流泪或自定义情绪表达 |
| `love` | 正面、左前侧转、右前侧转 | 心动，以及已通过的接触动作组合 |

扩展动作名包含 `shy / angry / talk / listen` 和任意新单人语义。它们不是每个新角色默认自带：旧预设可能有无方向元数据的 4×2 情绪包，新角色则在 Character Agent 需要或用户手动追加时生成 4×3 三方向增量包。制作面板不得把贴贴、拥抱或牵手作为单人动作追加。

行为意图到首选可见动作的回退映射为：移动/离开→`walk`，说话/请求/替代回应→`talk`，拒绝/移开视线→`angry`，接受→`shy`，观察/面向/犹豫→`listen`，其余→`idle`。若角色仍没有对应扩展动作，`PixelPetSprite` 最终使用 `idle`，后台任务继续补全动作。

### 9.2 生成、归一化和选帧

新基础动作表使用 `front-three-quarter-v2` 方向协议：4×5 网格共 20 帧，`idle / wave / cry / love` 都有正面、左前侧转、右前侧转，`walk` 有左右两组循环。新增量动作使用 4×3 网格：每列一个动作，三行分别是正面、左前侧转、右前侧转，一次最多生成四个动作。

左右前侧转必须分别绘制并保持正面可读，不能用简单镜像生成不对称角色。播放器优先读取 `facingFrames`：有独立方向帧时直接选帧；只有旧包没有方向元数据时，朝左才使用 CSS `scaleX(-1)`，朝右沿用原帧。世界空间状态只保存 `left / right`；`front` 用于制作页、头像和单人预览。

归一化版本 3 先识别透明或纯色背景，再结合行列低密度边界与 8 邻域连通主体为每个槽位提取完整角色，保持宽高比并统一脚底基线；它不再假定模型严格落在固定等分格中。完整帧必须达到 100%，边界置信必须至少 55%，否则资产不会登记。客户端 QA 还检查左右差异、镜像轮廓相干性、相对正面的转向差异、独立姿势与透明角。

版本 2 的 AIGC 基础表和生成动作包会在浏览器内复用原像素智能修复，不产生图像调用；更早且可能已经丢失源像素的动作表暂时使用完整待机帧。旧 `front-three-quarter-v1`、4×3 基础表和 4×2 预设增量包仍可读取。

动作定义可携带 `pixel-pet/action-unit/v1` 元数据：发起者/接收者角色、适用互动类型、四级空间等级、朝向要求、接触锚点、理想距离、允许误差、最大根节点修正、翻转/中断规则、五个关键阶段和失败回退。旧资产缺失字段时按动作名安全推断。

新生成增量动作会从正面、左前侧转、右前侧转峰值姿势分别提取 7 点骨骼，登记到 `keyframeRigs`。播放器通过共享会话阶段在双方各自不同长度的帧数组中选取对应区间：`prepare / contact_start / contact_hold / contact_end / recover`，而不是要求相同帧号。方向数据不足时，会话参与者优先显示可靠的方向待机帧，避免为了播放正面 `talk/listen` 破坏面对面。

Character Agent 返回 `animationAction` 与 `animationDescription`。调度器处理顺序为：

```text
精确匹配已有 ready 资产
  → 使用已有语义接近动作
  → 缺失时创建生成任务
  → 当前回合使用基础回退动作
  → 生成、浏览器归一化和校验
  → 以 append-only PixelPetActionPack 登记为 ready
```

新资产 ready 后不会强制播放旧意图。角色下一次被唤醒时重新判断是否仍要执行。

动作模型失败不会让角色无限等待；任务记录为 `failed`，世界继续使用安全回退。增量包采用 append-only 合并，不覆盖已存在的动作历史。

### 9.3 背景资产总索引与世界索引

背景资产是与角色动作包分离的资源域：

- `cp-dance/background-catalog/v1` 是 Background Asset Agent 的总索引。公开快照的 `public/backgrounds/index.json` 初始为空；部署者只可登记自有或已获授权的 ready 资产，D1 `cp_dance_background_assets` 追加 owner 隔离的生成资产元数据。
- `cp-dance/background-world-index/v1` 是单个世界的使用索引，保存 `assetIds / activeAssetId / sceneBindings / updatedAt`；D1 `cp_dance_world_background_assets` 是服务端投影，世界快照继续保存同一结构用于恢复。
- `resolve` 先搜索总索引并复用 ready 资产；找不到合适资产时自动调用背景生成。复用返回 `generationTriggered: false`，生成返回 `status: generated / generationTriggered: true`。
- 自动生成成功后先把图片写入 R2，再用同一批 D1 写入更新总索引和世界索引；响应返回时两级索引已经可查。保留的手动 `generate` 接口仍要求所有者明确确认。
- 生成文件名固定为 `bg_{world}_{location}_{time}_{weather}_{utc-timestamp}_{short-id}.png`，从场景语义和世界 ID 构成，不允许使用无语义序号名。
- Background Asset Agent 只返回资产和索引结果，不参与角色行为、同意、空间执行、关系裁决或记忆写入。

### 9.4 双人动作、面对面与位置控制

当前双人画面组合双方各自的单人资产，并由交互会话持续维护：

| 双人类型 | 动作组合 | 骨骼锚点 | 空间规则 |
| --- | --- | --- | --- |
| `conversation` | `talk + listen` | 胸↔胸 | 对方参与且未退出时面对面，不移动双方 |
| `eye_contact` | `listen + listen` | 头↔头 | 对方参与且未退出时面对面，不移动双方 |
| `touch` | `love + love` | 右手↔胸 | 明确接受且校验通过后对齐 |
| `hand_contact` | `love + love` | 右手↔左手 | 明确接受且校验通过后对齐 |
| `hug` | `love + love` | 胸↔胸 | 明确接受且按最严格阈值校验通过后对齐 |
| `cuddle` | `love + love` | 胸↔胸 | 明确接受且通过后进入 `touching/cuddle` |
| `head_touch / pat` | `wave + shy` | 右手↔头 / 胸 | 接收者保持，发起者承担主要微调 |
| `shoulder_lean` | `love + shy` | 头↔胸 | 正常接近后有限对齐 |
| `push` | `angry + walk` | 右手↔胸 | 接触后为接收者检查后退空间 |
| `shared_action / dance` | `wave + wave` | 髋↔髋 / 手↔手 | 建立持续距离约束 |
| `joint_walk / chase / assist` | `walk + walk` | 髋↔髋 / 胸↔胸 | 约束期间共同移动并保持相对位置 |

面对面不是固定翻转。执行器先比较实际 `x`：左边角色朝右，右边角色朝左；同一 `x` 时用稳定 ID 排序。交谈或对视仅在接收者实际参与，且没有拒绝、`look_away`、`move_away`、`end_interaction` 或 `respond_reject` 时强制相向。拒绝和离开优先，系统不能为了构图把角色转回来。

普通说话、观察和转向不改坐标；`move_closer / move_away / end_interaction` 只移动行动者。接触会话不再围绕共同中心瞬间吸附：先正常移动到预备距离，再按动作策略分配根节点微调；摸头/轻拍主要调整发起者，拥抱/牵手可由双方分担。距离使用 `hypot(dx, dy × 0.62)` 修正舞台纵深；小于等于 23 只表示 `near`，不能自动推导接触。

双人校验使用头、胸、髋、左右手、左右脚七点骨骼，优先读取动作关键帧骨骼，按动作检查身高差、锚点置信度、接触残差、根节点修正、第三人碰撞和舞台边界，并把安全缩放限制在 0.82–1.18。通过后输出完美或可接受匹配；不通过时保留“角色曾同意”的事实，但画面降级为 `near`，不写入 `touching`。第三人只能作为旁观者读取公开结果。

关系网的 `交谈 / 招呼 / 靠近 / 心动` 预览分别使用 `talk+listen / wave+wave / walk+listen / love+love`，仅检查动作和构图，不调用真实 Character Agent、不改变关系，也不表示同意。

## 10. API 与安全边界

| 路径 | 模型 | 用途 |
| --- | --- | --- |
| `GET /api/ai/status` | 无 | 检查图像与文本通道配置 |
| `GET /api/ai/background/status` | 无 | 检查 Background Asset Agent、公开基础目录和 D1/R2 状态 |
| `POST /api/ai/background` | `NEWAPI_IMAGE_MODEL`（仅总索引无匹配或手动生成时） | 解析/复用背景；无匹配时自动生成并更新总索引与世界索引 |
| `GET /api/background-assets?worldId=...` | 无 | 返回 owner 可见的总索引和指定世界索引 |
| `POST /api/ai/agent` | `NEWAPI_TEXT_MODEL`，默认 `deepseek-v4-flash` | 独立角色动作、回应与结构化记忆提案 |
| `POST /api/ai/director` | `NEWAPI_TEXT_MODEL`，默认 `deepseek-v4-flash` | 导演模式的大纲、剧情节拍、公开世界事件和场景提议；不输出角色行为 |
| `POST /api/ai/character` | `NEWAPI_IMAGE_MODEL`，默认 `gpt-image-2` | 经 `/images/edits` 生成 4×5、20 帧三朝向基础动作表 |
| `POST /api/ai/pet-actions` | `NEWAPI_IMAGE_MODEL` | 生成缺失动作表 |
| `POST /api/research/character/search` | 无 | 搜索 Wikipedia/Wikidata/萌娘百科候选，不自动选择 |
| `POST /api/research/character/extract` | `NEWAPI_TEXT_MODEL`；未配置时可降级 | 读取玩家确认的 1–3 个候选，返回带来源、置信度和局限、默认未确认的混合审阅草稿 |
| `POST /api/research/character/distill` | `NEWAPI_TEXT_MODEL`；未配置时可确定性降级 | 仅融合玩家资料与已确认证据，返回可编辑的最终 Profile 预览；不直接写入档案或记忆 |

`worker/agent-config.ts` 是统一配置中心：生图 Agent 读取 `NEWAPI_IMAGE_*`，Character Agent 等文本 Agent 读取 `NEWAPI_TEXT_*`。密钥只存在于 Worker 环境变量。服务端限制请求大小、超时、输出字段和 actor/target 权限；浏览器不能读取密钥。

## 11. 当前实现与边界

已实现：

- 1–3 人建档、双向关系网、角色制作，以及进入前的自然模式 / 导演模式选择；进入后模式锁定；
- `cp-dance/director-state/v1`、`cp-dance/director-decision/v1`、独立 `/api/ai/director`、4 回合冷却、玩家方向分类、公开事件校验和预设场景匹配；
- 真实 Character Agent API 两阶段调用；
- 角色上下文隔离与接触请求—回应；
- 相对空间语义和可视坐标映射；
- 本地 Interaction/Relationship Judge；
- `Character Profile v2`、玩家可选的 `Character Reference Pack v1`、每个 A→B 的定性 Relationship Lens，以及 `cp-dance/character-context/v6` 角色表演上下文；
- Wikipedia/Wikidata/萌娘百科搜索、作品范围消歧与角色别名重搜、多来源确认和混合整理、逐条编辑/勾选、确认资料与玩家资料蒸馏、最终 Profile 预览编辑、显式应用和单向原作关系草稿；未确认草稿不进入角色档案或 Agent 记忆，萌娘百科资料始终带原页链接、署名和非商业许可；
- 注意力调度、逐字公开对话、非语言动作、话题、最多十二个连续节拍和待回答问题；
- `cp-dance/group-scene/v1` 多人共享场景、局部指向、独立回应和参与/观察/退出状态；
- 方向性记忆文档、角色感回调线索、认识状态、证据、revision 先读后写、本地提案校验与安全回退；
- 最多 12 个独立世界及最多 30 个可复用角色的服务端存档；
- 世界内缺失动作后台识别、生成、校验、登记和失败回退；当前回合不等待新资产；
- 可由部署者填充的背景总索引、独立 Background Asset Agent、场景优先复用、无匹配自动生成，以及 R2/D1 总索引与世界索引同步写入；
- 通用 7 点互动骨骼、身高差与接触点残差校验，以及不兼容动作的安全降级；
- `cp-dance/interaction-session/v1` 双人会话、四级空间要求、分步正常移动、有限根节点细对齐、三档匹配结果与自动恢复；
- 舞台中持续相向的左右朝向、五个关键阶段同步，以及轻触、牵手、拥抱、贴贴、摸头、轻拍、靠肩、推开和共同移动的运行时组合；
- D1 最新存档/版本/记忆文档/记忆 revision/世界事件索引，R2 最多 20 个聚合版本快照、不可变记忆 revision、事件体和内容寻址图片资源；
- 导演模式的设置区和运行面板；角色只接收公开场景与事件，隐藏大纲、结局目标和导演理由不进入 Character Agent。
- macOS/Windows 主显示器桌宠 MVP：透明置顶、仅角色命中、鼠标穿透看门狗、拖拽/短暂点击、超过 50% 重叠时柔和微调、公开距离事件、独立回应队列、网页隐藏重复形象、显式保存与收回网页。

尚未实现：

- 向量或语义嵌入检索；当前先使用可复现、可审计的对象/显著性/新近度/任务类型排序；
- 以事件流重建整个聚合世界的恢复流程；目前事件体已 append-only 投影，最新世界仍以版本化聚合快照为恢复权威；
- 可跨页面关闭继续运行的服务端资产队列；当前后台动作任务由浏览器调度，刷新后由下次意图重新触发；
- 任意新姿势的双角色合成图生成；当前通用骨骼负责校验和舞台对齐，双方动作可同步但仍组合各自的动作资产；
- 五阶段分别绘制的多关键帧增量动作包；当前 4×3 v1 为每个动作/方向提供一个峰值姿势，运行时用方向待机帧完成准备与恢复；
- 三人同步身体接触或统一组合动作。三人现在可以处在同一公开对话/活动场景中，但任何接触和双人资产仍逐对请求、逐对裁决。

旧存档缺少 `mode` 时按自然模式恢复；只有带有效 `cp-dance/director-state/v1` 的故事存档才恢复为导演模式。历史遗留导演字段仍会在迁移时丢弃，不能绕过当前协议。
