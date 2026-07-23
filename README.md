# CP Dance / CP 跳动
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/6a2d3721-cf51-4ad6-a2dd-a577c1947c35" />

[English](README.md) | [简体中文](README.zh-CN.md)

CP Dance is a consent-aware pixel-character social simulation. Each character
has an independent Character Agent, directional relationship state, private
memory, and the right to reply, hesitate, refuse, stay silent, or leave.

> Detailed setup and API configuration: [中文运行指南](docs/RUNNING_GUIDE.zh-CN.md)

The project supports two separately entered experiences:

- **Natural mode** wakes characters without prewriting a plot.
- **Director mode** arranges public scenes and plot beats but cannot write a
  character's dialogue, read private memory, or decide relationship outcomes.

Both modes share the same Character Agents, Interaction Runtime, Relationship
Judge, spatial model, and versioned memory boundaries.

## Open-source snapshot

The public repository contains source code, schemas, migrations, architecture
documents, and tests. It intentionally contains no character art, sprite sheets,
background artwork, ZIP bundles, brand artwork, social-preview images, private
saves, API credentials, or production deployment IDs.

Bring assets you created or are licensed to use. See [ASSETS.md](ASSETS.md).
The MIT license applies to code and repository documentation, not third-party
characters, trademarks, user content, or generated media.

## Core boundaries

- `A → B` and `B → A` are independent relationship directions.
- A model call controls one character only.
- A receiver sees public actions and dialogue, never the other character's
  private thought, goal, memory, or exact relationship values.
- Contact and two-character actions require request, independent response,
  boundary adjudication, and a safe fallback.
- Animation availability never grants behavioral authority or consent.
- Models propose memory revisions; the Memory Runtime validates evidence,
  ownership, and base revisions before committing.
- Player input can advance a moment but cannot force a relationship result.

## Architecture

```text
Scheduler / Director
        │ public task
        ▼
Character Agent ── proposal ──► Interaction Runtime
                                      │
                  independent reply ◄─┤
                                      ▼
                         Relationship Judge
                                      │
                                      ▼
                 public events + private memory revisions
```

Important modules:

- `lib/agent-engine.ts`: world runtime and state transitions.
- `lib/natural-agent-types.ts`: Character Agent task and response contracts.
- `lib/interaction-session.ts`: phased spatial and duo-action sessions.
- `lib/relationship-engine.ts`: directional relationship adjudication.
- `lib/character-memory.ts`: evidence-backed versioned private memory.
- `worker/ai-api.ts`: server-side Character Agent boundary.
- `worker/save-api.ts`: D1/R2 world and character persistence.
- `desktop/`: optional Electron transparent desktop surface.

Read [docs/PROJECT_HANDOFF.md](docs/PROJECT_HANDOFF.md) and
[docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md) before changing domain
authority or persistence behavior.

## Requirements

- Node.js 22.13 or newer
- npm
- Optional Cloudflare D1/R2 bindings for persistent saves
- Optional text and image model endpoints

## Local development

```bash
npm install
cp .env.example .env.local
# Edit .env.local, then:
npm run dev
```

The repository starts with an empty background catalog and no character
presets. Upload a reference image you are authorized to use when creating a
character. Image generation fails closed when no image provider is configured.

Environment variables are server-side only. Recommended models:

- Text: **DeepSeek V4**. The default example uses `deepseek-v4-flash`; use the
  exact DeepSeek V4 model ID exposed by your provider.
- Image: **GPT Image 2**, configured as `gpt-image-2`.

```bash
NEWAPI_BASE_URL=
NEWAPI_IMAGE_BASE_URL=https://image-provider.example.com/v1/images/edits
NEWAPI_IMAGE_API_KEY=
NEWAPI_IMAGE_MODEL=gpt-image-2
NEWAPI_TEXT_BASE_URL=https://text-provider.example.com/v1
NEWAPI_TEXT_API_KEY=
NEWAPI_TEXT_MODEL=deepseek-v4-flash
```

| Channel | Used by |
| --- | --- |
| `NEWAPI_TEXT_*` | Character decisions and dialogue, Director outlines and public story compaction, optional character-research correction/extraction/distillation |
| `NEWAPI_IMAGE_*` | Base character sprite sheets, incremental action sheets, and background generation when no licensed catalog asset matches |

The text endpoint must be an OpenAI-compatible API root such as
`https://provider.example.com/v1`, not the full `/chat/completions` URL. The
image endpoint may be the API root or its `/v1/images/edits` URL.

See the [Chinese running guide](docs/RUNNING_GUIDE.zh-CN.md) for a complete
function map, deployment settings, status checks, and troubleshooting. Never
commit `.env.local` or real credentials.

## Persistence

`/api/saves` stores indexes and version metadata in D1 and full snapshots or
private media in R2. Anonymous users are isolated by an HttpOnly session cookie;
authenticated deployments can isolate owners by server-provided identity.

The included `.openai/hosting.json` is a placeholder. Replace its project ID or
adapt `vite.config.ts` for your hosting platform. Do not reuse another owner's
project ID, database, bucket, or public origin.

## Validation

```bash
npm audit
npm test
npm run desktop:test
npm run lint
npm run typecheck
git diff --check
```

Automated tests mock image generation and must not create billable media.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for domain constraints and validation.
Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## License

Source code and repository documentation are available under the [MIT License](LICENSE).
Asset rights are described separately in [ASSETS.md](ASSETS.md).
