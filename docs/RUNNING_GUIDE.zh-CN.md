# CP 跳动运行与 API 配置指南

这份指南说明如何在本地启动 CP 跳动、API 应该写在哪里、两类模型分别会被哪些功能调用，以及部署时如何避免泄露密钥。

## 1. 最快启动

要求：

- Node.js 22.13 或更高版本
- npm

```bash
git clone https://github.com/qiukuizhenpiaoliang-dot/cp-dance.git
cd cp-dance
npm install
cp .env.example .env.local
```

编辑 `.env.local`，填入服务端 API 配置：

```bash
# 旧版共享地址，仅用于兼容；新部署建议保持为空
NEWAPI_BASE_URL=

# 图像模型通道
NEWAPI_IMAGE_BASE_URL=https://your-image-provider.example.com/v1/images/edits
NEWAPI_IMAGE_API_KEY=
NEWAPI_IMAGE_MODEL=gpt-image-2

# 文字模型通道
NEWAPI_TEXT_BASE_URL=https://your-text-provider.example.com/v1
NEWAPI_TEXT_API_KEY=
NEWAPI_TEXT_MODEL=deepseek-v4-flash
```

请只在等号右侧填入自己的密钥，不要把修改后的 `.env.local` 提交到 Git。

然后启动：

```bash
npm run dev
```

根据终端输出打开本地地址，通常是 `http://localhost:3000`。

只想查看界面时可以暂时不配置模型。未配置的模型功能会关闭或安全失败，不会在浏览器中模拟成真实 Agent 结果。

## 2. 推荐模型

### 文字模型：DeepSeek V4

推荐使用 **DeepSeek V4 系列**。项目默认模型 ID 是 `deepseek-v4-flash`，适合角色回合、结构化 JSON 和剧情整理。

不同 API 服务商暴露的模型 ID 可能是 `deepseek-v4`、`deepseek-v4-flash`、`deepseek-v4-pro` 或其他名称。`NEWAPI_TEXT_MODEL` 必须填写服务商控制台中实际可用的精确 ID；“DeepSeek V4”是推荐模型系列，不保证所有服务商使用同一个字符串。

### 图像模型：GPT Image 2

推荐使用 **GPT Image 2**，项目默认模型 ID 是：

```bash
NEWAPI_IMAGE_MODEL=gpt-image-2
```

图像服务必须支持项目使用的图片编辑和生成接口。角色与动作表调用 `/v1/images/edits`，背景生成调用 `/v1/images/generations`。

## 3. 每个配置项的作用

| 环境变量 | 填写内容 | 说明 |
| --- | --- | --- |
| `NEWAPI_TEXT_BASE_URL` | 文字服务的 OpenAI 兼容 API 根地址 | 建议填到 `/v1`，不要填完整的 `/chat/completions` |
| `NEWAPI_TEXT_API_KEY` | 文字服务密钥 | 只在服务端使用 |
| `NEWAPI_TEXT_MODEL` | 服务商提供的精确文字模型 ID | 推荐 DeepSeek V4 系列；默认 `deepseek-v4-flash` |
| `NEWAPI_IMAGE_BASE_URL` | 图像服务根地址或 `/v1/images/edits` 地址 | 代码会统一解析为 API 根地址 |
| `NEWAPI_IMAGE_API_KEY` | 图像服务密钥 | 只在服务端使用 |
| `NEWAPI_IMAGE_MODEL` | 服务商提供的精确图像模型 ID | 推荐并默认 `gpt-image-2` |
| `NEWAPI_BASE_URL` | 旧版共享 API 地址 | 仅作兼容回退；新部署不要依赖它 |

配置的唯一代码入口是 `worker/agent-config.ts`。浏览器只调用本站 `/api/...` 路由，不应读取或接收模型密钥。

## 4. 文字 API 会用在哪里

配置 `NEWAPI_TEXT_*` 后，以下功能会调用文字模型：

| 产品功能 | 内部路由 | 模型做什么 |
| --- | --- | --- |
| 自然模式角色行动与对话 | `POST /api/ai/agent` | 一次只决定一个角色自己的动作、公开台词、回应或沉默 |
| 导演模式 | `POST /api/ai/director` | 创建或调整公开剧情大纲、场景和 Plot Beat，不代替角色作决定 |
| 剧情上下文压缩 | `POST /api/ai/director`，`taskType=compact_story` | 压缩已经公开、已经发生的剧情事实，不生成未来结果 |
| 角色考据搜索辅助 | `POST /api/research/character/search` | 普通检索无有效人物候选时，只辅助纠正角色别名后重搜 |
| 角色考据提取 | `POST /api/research/character/extract` | 整理玩家确认的来源正文，生成带证据的待审阅草稿 |
| 人物档案蒸馏 | `POST /api/research/character/distill` | 把玩家资料与已确认证据融合成可编辑预览 |

Character Agent 始终只控制当前被分配的角色。模型不能替另一个角色同意接触，也不能直接写关系结果或越权读取另一角色的私有记忆。

## 5. 图像 API 会用在哪里

配置 `NEWAPI_IMAGE_*` 后，以下功能会调用图像模型：

| 产品功能 | 内部路由 | 模型做什么 |
| --- | --- | --- |
| 创建可交互角色 | `POST /api/ai/character` | 根据玩家上传的参考图生成 4×5、20 帧、三朝向基础动作表 |
| 补充角色动作 | `POST /api/ai/pet-actions` | 为缺失语义生成 4×3、三朝向增量动作表 |
| 背景生成 | `POST /api/ai/background` | 背景目录没有合适匹配时生成背景，并在配置 D1/R2 后登记资产 |

注意：

- 公开仓库不附带角色图和背景图，使用者需要上传自有或已获授权的素材。
- 背景解析在目录无匹配时支持自动生成，可能产生 API 费用。
- 手动强制生成背景仍要求所有者在界面明确确认。
- 自动测试使用 mock，不会调用真实图像 API。

## 6. 检查是否配置成功

启动本地服务后可以检查：

```bash
curl http://localhost:3000/api/ai/status
curl http://localhost:3000/api/ai/background/status
```

第一项会返回文字和图像通道是否已配置、当前模型名及协议；不会返回 API Key。第二项会显示背景生成与 D1/R2 存储是否可用。

也可以先运行项目验证：

```bash
npm audit
npm test
npm run desktop:test
npm run lint
npm run typecheck
```

## 7. 部署时在哪里配置

本地开发使用项目根目录的 `.env.local`。

线上部署时，在你的托管平台项目设置中添加同名的 `NEWAPI_TEXT_*` 和 `NEWAPI_IMAGE_*` 服务端环境变量。不要把真实值写进以下文件：

- `.env.example`
- `.openai/hosting.json`
- README 或其他 Markdown
- 前端 `NEXT_PUBLIC_*` 变量
- GitHub 提交、Issue、PR 或构建日志

`.openai/hosting.json` 只保存 Sites 项目标识和 D1/R2 的逻辑绑定，不存模型密钥。公开仓库中的项目 ID 是占位值，部署前必须替换为你自己的项目。

需要持久存档和生成背景时，还要绑定：

- D1：`DB`
- R2：`SAVE_ASSETS`

没有 D1/R2 时仍可检查界面和部分 Agent 流程，但服务端存档、私有图片及生成背景的持久化能力不完整。

## 8. 线上站点使用桌宠

桌宠模式由“线上网页 + 同一台电脑上的本机 Electron 伴侣”共同组成。线上网页不能独自创建透明桌面窗口。

使用官方体验站时，在本机克隆仓库、安装依赖并运行：

```bash
npm install
npm run desktop:dev
```

保持网页标签页打开，进入自然模式世界后点击“切到桌宠展示”。官方体验站来源已默认允许。

如果你部署到了其他域名，需要在启动本机伴侣时显式填写完整来源：

```bash
CP_DANCE_ALLOWED_ORIGINS=https://your-site.example.com npm run desktop:dev
```

白名单采用精确来源匹配，不要填写路径、通配符或不受信任的域名。当前桌宠 MVP 支持 macOS 和 Windows，尚未打包签名安装程序。

## 9. 常见问题

### 显示“文本 Agent 服务尚未配置”

检查 `NEWAPI_TEXT_BASE_URL` 和 `NEWAPI_TEXT_API_KEY` 是否都已填写，然后重启开发服务器。

### 显示角色制作 Agent 未配置

检查 `NEWAPI_IMAGE_BASE_URL` 和 `NEWAPI_IMAGE_API_KEY`。图像地址可以填 API 根地址，也可以填服务商给出的 `/v1/images/edits` 地址。

### 返回 401 或 403

密钥无效、余额不足，或当前账号没有目标模型权限。到 API 服务商控制台检查密钥和模型授权。

### 返回 404 或“模型不可用”

通常是 Base URL 填成了完整接口地址，或模型 ID 与服务商实际名称不一致。文字地址应停在 `/v1`；模型名应从服务商控制台复制。

### 修改 `.env.local` 后仍使用旧配置

停止并重新运行 `npm run dev`。环境变量在服务启动时读取。

### 线上点击“切到桌宠展示”后提示无法连接

确认本机已经运行 `npm run desktop:dev`。自定义域名还必须通过 `CP_DANCE_ALLOWED_ORIGINS` 放行；官方体验站无需额外填写。浏览器可能会首次询问本地网络访问权限，请允许当前站点连接本机伴侣。

## 10. 密钥安全

`.env.local` 已被 `.gitignore` 排除。提交前仍建议运行：

```bash
git status --short
git grep -n "API_KEY="
```

确认 Git 里只有 `.env.example` 的空值和测试专用假 Key。若真实 Key 曾经进入 Git 历史，仅删除文件并不够；应立即在服务商处撤销旧 Key、创建新 Key，并清理远端历史。
