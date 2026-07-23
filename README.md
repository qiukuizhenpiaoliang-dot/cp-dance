# CP Dance / CP 跳动

[English](README.md) | [简体中文](README.zh-CN.md)
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/134b0b30-5124-4239-b83d-31fc179227fa" />


CP 跳动是一个重视角色自主权与同意边界的像素角色社交模拟。每个角色都有独立的 Character Agent、方向性关系状态和私有记忆，也始终保留回应、犹豫、拒绝、沉默或离开的权利。

> 详细启动与 API 配置：[中文运行指南](docs/RUNNING_GUIDE.zh-CN.md)

项目提供两种分别进入的体验：

- **自然模式**：不预写剧情，由调度器根据当前世界状态唤醒角色。
- **导演模式**：安排公开场景和剧情节拍，但不能替角色写台词、读取私有记忆或决定关系结果。

两种模式共用相同的 Character Agent、Interaction Runtime、Relationship Judge、空间模型和版本化记忆边界。

## 开源快照

公开仓库包含源代码、数据库结构、迁移、架构文档和测试。仓库有意不包含角色美术、Sprite Sheet、背景图、ZIP 素材包、品牌图、社交预览图、私人存档、API 密钥或生产部署 ID。

请使用自己创作或已经获得合法授权的素材，详见 [ASSETS.md](ASSETS.md)。MIT 许可证适用于源代码和仓库文档，不自动授予第三方角色、商标、用户内容或生成媒体的权利。

## 核心边界

- `A → B` 与 `B → A` 是两个独立的关系方向。
- 每次模型调用只能控制一个角色。
- 接收者只能看到公开动作和台词，不能看到另一角色的私有想法、目标、记忆或精确关系数值。
- 接触和双人动作必须经过请求、独立回应、边界裁决和安全回退。
- 拥有某个动画资源不代表角色已经同意执行该行为。
- 模型只能提出记忆修订；Memory Runtime 会在提交前校验证据、所有权和基础版本。
- 玩家输入可以推动当下情境，但不能强制产生关系结果。

## 架构

```text
调度器 / Director
        │ 公开任务
        ▼
Character Agent ── 提案 ──► Interaction Runtime
                                  │
                独立回应 ◄────────┤
                                  ▼
                         Relationship Judge
                                  │
                                  ▼
                    公开事件 + 私有记忆修订
```

重要模块：

- `lib/agent-engine.ts`：世界运行时与状态转换。
- `lib/natural-agent-types.ts`：Character Agent 任务和响应协议。
- `lib/interaction-session.ts`：分阶段空间接触和双人动作会话。
- `lib/relationship-engine.ts`：方向性关系裁决。
- `lib/character-memory.ts`：基于证据的版本化私有记忆。
- `worker/ai-api.ts`：服务端 Character Agent 权限边界。
- `worker/save-api.ts`：D1/R2 世界与角色持久化。
- `desktop/`：可选的 Electron 透明桌面角色层。

修改领域权限或存储行为前，请先阅读 [项目交接手册](docs/PROJECT_HANDOFF.md) 和 [Agent 架构](docs/AGENT_ARCHITECTURE.md)。

## 运行要求

- Node.js 22.13 或更高版本
- npm
- 可选：用于持久化存档的 Cloudflare D1/R2
- 可选：文字和图像模型服务

## 本地启动

```bash
npm install
cp .env.example .env.local
# 编辑 .env.local 后运行：
npm run dev
```

公开仓库初始使用空背景目录，也不附带角色预设。创建角色时，请上传自己拥有或获准使用的参考图。没有配置图像服务时，图像生成功能会安全失败，不会伪装成真实生成结果。

环境变量只在服务端使用。推荐模型：

- 文字模型：**DeepSeek V4**。默认示例使用 `deepseek-v4-flash`，请填写你的服务商实际提供的 DeepSeek V4 模型 ID。
- 图像模型：**GPT Image 2**，配置为 `gpt-image-2`。

```bash
NEWAPI_BASE_URL=
NEWAPI_IMAGE_BASE_URL=https://image-provider.example.com/v1/images/edits
NEWAPI_IMAGE_API_KEY=
NEWAPI_IMAGE_MODEL=gpt-image-2
NEWAPI_TEXT_BASE_URL=https://text-provider.example.com/v1
NEWAPI_TEXT_API_KEY=
NEWAPI_TEXT_MODEL=deepseek-v4-flash
```

| 通道 | 使用功能 |
| --- | --- |
| `NEWAPI_TEXT_*` | 角色决策与对话、导演大纲、公开剧情压缩，以及可选的人物考据纠错、提取和蒸馏 |
| `NEWAPI_IMAGE_*` | 角色基础动作表、增量动作表，以及没有合法目录素材匹配时的背景生成 |

文字服务地址必须是 OpenAI 兼容 API 根地址，例如 `https://provider.example.com/v1`，不要填写完整的 `/chat/completions` 地址。图像服务可以填写 API 根地址，也可以填写 `/v1/images/edits` 地址。

完整的功能对应表、部署配置、状态检查和排错方法请阅读 [中文运行指南](docs/RUNNING_GUIDE.zh-CN.md)。不要提交 `.env.local` 或任何真实密钥。

## 持久化

`/api/saves` 在 D1 中保存索引与版本元数据，在 R2 中保存完整快照或私有媒体。匿名用户通过 HttpOnly 会话 Cookie 隔离；带身份系统的部署可以使用服务端身份继续隔离不同所有者。

仓库中的 `.openai/hosting.json` 是占位配置。请替换为自己的项目 ID，或修改 `vite.config.ts` 适配其他托管平台。不要复用其他所有者的项目 ID、数据库、存储桶或公开来源。

## 验证

```bash
npm audit
npm test
npm run desktop:test
npm run lint
npm run typecheck
git diff --check
```

自动测试会模拟图像生成，不会创建需要付费的真实图片。

## 贡献与安全

领域约束和提交检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按照 [SECURITY.md](SECURITY.md) 中的方式报告。

## 许可证

源代码和仓库文档采用 [MIT License](LICENSE)。素材权利另见 [ASSETS.md](ASSETS.md)。
