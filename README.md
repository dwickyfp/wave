# Emma Chatbot

[![MCP Supported](https://img.shields.io/badge/MCP-Supported-00c853)](https://modelcontextprotocol.io/introduction)
[![Local First](https://img.shields.io/badge/Local-First-blue)](https://localfirstweb.dev/)
[![AI SDK](https://img.shields.io/badge/AI_SDK-v6-blueviolet)](https://sdk.vercel.ai/)

**Emma Chatbot** is an open-source AI chatbot for individuals and teams, inspired by ChatGPT, Claude, Grok, and Gemini. Built with **[Vercel AI SDK v6](https://sdk.vercel.ai/)** and **Next.js**, it combines the best capabilities of leading AI services into a single customizable platform.

---

## Table of Contents

- [Features Overview](#features-overview)
- [Getting Started](#getting-started)
  - [Quick Start with Docker](#quick-start-with-docker)
  - [Quick Start (Local)](#quick-start-local)
  - [Environment Variables](#environment-variables)
- [Feature Details](#feature-details)
  - [Custom Agents](#custom-agents)
  - [Agent-to-Agent (Sub-Agents)](#agent-to-agent-sub-agents)
  - [A2A Federation](#a2a-federation)
  - [Snowflake Intelligence Agents](#snowflake-intelligence-agents)
  - [Emma Pilot Browser Copilot](#emma-pilot-browser-copilot)
  - [ContextX Knowledge System](#contextx-knowledge-system)
  - [Visual Workflows](#visual-workflows)
  - [MCP Tool Integration](#mcp-tool-integration)
  - [@mention & Tool Presets](#mention--tool-presets)
  - [Tool Choice Mode](#tool-choice-mode)
  - [Built-in Tools](#built-in-tools)
  - [Voice Assistant](#voice-assistant)
- [Guides](#guides)
- [Tips](#tips)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Support](#support)

---

## Features Overview

| Category          | Features                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| **AI Providers**  | OpenAI, Anthropic, Google, xAI, Ollama, OpenRouter, and any OpenAI-compatible provider                            |
| **Agents**        | Custom agents, sub-agents, remote A2A agents, Snowflake Cortex agents, and browser-aware Emma Pilot orchestration |
| **Knowledge**     | ContextX ingestion, chunking, enrichment, retrieval, reranking, and group-scoped knowledge memories               |
| **Tools**         | MCP protocol, web search, JS/Python execution, data visualization, image generation, HTTP client                  |
| **Workflows**     | Visual node-based workflows as callable tools                                                                     |
| **Voice**         | Realtime voice assistant with full MCP tool integration                                                           |
| **UX**            | `@mention` to invoke any tool, agent, or workflow instantly, plus Emma Pilot browser copilot for Chrome and Edge  |
| **Collaboration** | Share agents, workflows, MCP configurations, and published A2A endpoints with your team                           |
| **Deployment**    | One-click Vercel deploy, Docker Compose, local setup, and extension packaging for Emma Pilot                      |

---

## Getting Started

> This project uses [pnpm](https://pnpm.io/) as the recommended package manager.

```bash
# Install pnpm if you don't have it
npm install -g pnpm
```

You only need **one AI provider API key** (OpenAI, Claude, Gemini, etc.) to get started. Database, file storage, and hosting all have free tiers.

### Quick Start with Docker

```bash
# 1. Install dependencies (also generates .env file)
pnpm i

# 2. Fill in at least one LLM provider API key in .env

# 3. Start all services including PostgreSQL
pnpm docker-compose:up
```

### Quick Start (Local)

```bash
# 1. Install dependencies
pnpm i

# 2. Start a local PostgreSQL instance (skip if you have your own)
pnpm docker:pg

# 3. Fill in required values in .env (at minimum: one LLM API key + POSTGRES_URL)

# 4. Build and start
pnpm build:local && pnpm start
```

For development with hot-reload:

```bash
pnpm dev
```

Alternative: Docker for DB only, run app via pnpm:

```bash
docker compose -f docker/compose.yml up -d postgres
pnpm db:migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to get started.

### Environment Variables

Running `pnpm i` automatically generates a `.env` file. Fill in the values below:

```dotenv
# === LLM Providers (fill in at least one) ===
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
OPENROUTER_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434/api

# === Auth ===
# Generate with: npx @better-auth/cli@latest secret
BETTER_AUTH_SECRET=****
BETTER_AUTH_URL=

# === Database ===
POSTGRES_URL=postgres://your_username:your_password@localhost:5432/your_database_name

# === Tools (Optional) ===
# Exa AI for web search — free tier: 1,000 req/month
EXA_API_KEY=

# MCP config mode (default: false = database-driven)
FILE_BASED_MCP_CONFIG=false

# === File Storage ===
FILE_STORAGE_TYPE=vercel-blob
FILE_STORAGE_PREFIX=uploads
BLOB_READ_WRITE_TOKEN=

# === OAuth (optional) ===
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_FORCE_ACCOUNT_SELECTION=

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_FORCE_ACCOUNT_SELECTION=

# Set to 1 to disable new user sign-ups
DISABLE_SIGN_UP=

# Set to 1 to prevent users from adding MCP servers
NOT_ALLOW_ADD_MCP_SERVERS=
```

---

## Feature Details

### Custom Agents

Create specialized AI agents with their own identity, instructions, and tools.

- Define a **system prompt** to give the agent a role and context
- Assign specific tools (MCP servers, workflows, built-in tools) the agent can use
- Invoke any agent in chat with `@agent_name`

**Example:** A GitHub Manager agent with issue/PR tools and repository context — call it with `@github_manager` to manage your repo directly from the chat.

---

### Agent-to-Agent (Sub-Agents)

Sub-agents extend custom agents with **hierarchical delegation** — a parent agent can autonomously hand off tasks to specialized child agents.

Built on **Vercel AI SDK v6's `ToolLoopAgent`**, each sub-agent runs as an independent tool within its parent's tool set.

**How it works:**

1. Define sub-agents for a parent agent, each with its own instructions and tools
2. When the parent agent receives a task, it can delegate subtasks to relevant sub-agents
3. Each sub-agent runs its own autonomous loop (up to 10 steps), streaming results back in real time
4. The parent agent incorporates the sub-agent's output and continues reasoning

**Key details:**

- Sub-agents are stored per-agent and loaded dynamically at chat time
- Each sub-agent is exposed to the parent as a tool: `subagent_{name}_{id}`
- Sub-agents support streaming with real-time progress UI (`SubAgentProgress` component)
- Sub-agents can be enabled/disabled individually
- **AI generation:** Describe the sub-agent you want and the system will auto-generate its name, description, instructions, and tool selection

**Example use case:** A research assistant agent delegates to:

- A `web_researcher` sub-agent (with web search tools)
- A `data_analyst` sub-agent (with JS execution and chart tools)
- A `summarizer` sub-agent (text-only, focused on synthesis)

The parent orchestrates across all three, producing a final comprehensive answer.

---

### A2A Federation

Emma supports the **Agent-to-Agent (A2A) protocol** in two directions:

- **Consume remote A2A agents** by discovering and connecting to external agent cards
- **Publish local Emma agents** as A2A-compatible endpoints that other runtimes can call

This is different from sub-agents. Sub-agents are private, in-process delegation inside Emma. A2A federation is for **cross-runtime interoperability**.

**How it works:**

1. A user enters an A2A endpoint URL
2. Emma resolves likely agent card URLs, fetches the card, validates the JSON card payload, and stores the remote config
3. The remote A2A agent becomes available inside Emma as an agent target
4. When invoked, Emma streams the remote task/events, extracts visible text/artifacts, and returns the result inside the normal chat experience
5. For published local agents, Emma exposes an A2A server endpoint and agent card so other clients can discover and call that agent

**What the published A2A server can execute:**

- Standard Emma custom agents
- Remote A2A-backed agents
- Snowflake Cortex agents

**Implementation flow:**

1. **Discovery**: Emma normalizes the input URL, tries direct and fallback card paths, then validates the returned card document
2. **Authentication**: Remote A2A configs can use bearer or custom header auth
3. **Invocation**: Emma creates a transport client, sends the user message/task, and streams task status plus artifact updates
4. **Published serving**: Local agents are wrapped in an A2A executor and exposed with an agent card, skill metadata, and optional bearer auth
5. **State continuity**: Emma keeps task/context identifiers and, when needed, remote context/task IDs so the next turn can continue the same remote task

**Why it matters:**

- Connect Emma to external agent ecosystems without rewriting them as native tools
- Publish internal Emma agents to other A2A-capable platforms
- Build mixed orchestration where Emma is both an A2A client and an A2A server

---

### Snowflake Intelligence Agents

Emma can connect directly to **Snowflake Cortex Agents** and expose them as first-class Emma agents.

These agents are useful when the main reasoning or data access should run inside Snowflake, close to governed enterprise data.

**How it works:**

1. Create an agent with Snowflake account, schema, Cortex agent name, and key-pair auth details
2. Emma generates a Snowflake JWT on demand for each request
3. Emma opens or continues a Snowflake Cortex thread
4. The latest user message is sent to the Snowflake agent
5. Emma streams back text deltas and rendered markdown tables into the chat UI

**Execution flow:**

1. **Configuration**: Store Snowflake account identifiers, database/schema, Cortex agent name, optional role, and private key credentials
2. **Auth**: Emma signs a short-lived Snowflake JWT using the configured key pair
3. **Threading**: Emma can create a Snowflake Cortex thread and keep `thread_id` plus `parent_message_id` metadata for multi-turn continuity
4. **Streaming**: Snowflake SSE events are parsed so visible answer text and result tables stream back progressively
5. **Presentation**: Table events are converted into GitHub-flavored markdown tables so they render naturally in chat

**Why it matters:**

- Bring governed warehouse-native intelligence into the same agent surface as LLM agents, MCP tools, and workflows
- Keep long-running analytical reasoning inside Snowflake while Emma handles chat UX, sharing, and orchestration
- Use Snowflake agents directly or publish them again through Emma's A2A server layer

---

### Emma Pilot Browser Copilot

**Emma Pilot** is Emma's browser copilot for Chrome and Microsoft Edge. It turns the browser side panel into a browser-aware, agentic workspace that can read the active tab, reason over the page, and propose or execute browser actions.

Emma Pilot is not just a chat widget. It is a **broker/orchestrator** on top of the Emma agent platform.

**Core capabilities:**

- Reads the active browser tab through structured DOM snapshots
- Adds hybrid visual context with redacted viewport screenshots when the selected model supports vision
- Uses the selected Emma agent's tools, knowledge, workflows, and sub-agents for deeper reasoning
- Keeps browser control centralized in the Emma Pilot broker
- Can continue automatically after safe browser actions until it reaches a user question or an approval boundary

**How it works:**

1. The extension authenticates against the signed-in Emma web session
2. The side panel captures browser context from the active tab:
   - forms and fields
   - standalone editable controls
   - actionable buttons and links
   - focused element and selected text
   - viewport and visual capture metadata
3. Emma Pilot sends the user turn plus browser context to the broker API
4. The broker decides whether to explain, analyze, navigate, or fill a form
5. The broker can delegate reasoning to the selected Emma agent, but only Emma Pilot proposes browser actions
6. Safe actions can auto-run; protected actions stay guarded
7. After execution, Emma Pilot refreshes the page context and can continue the task automatically

**Action model:**

- **Safe actions**: highlight, scroll, ordinary field fill, simple selection, and similar non-destructive interactions
- **Protected actions**: delete, save, update, commit, purchase, submit, or other high-impact mutations unless clearly requested by the user
- **Sensitive fields**: passwords, secrets, and payment-related inputs require confirmation

**Hybrid DOM + vision flow:**

1. DOM snapshot remains the source of truth for stable `elementId` targeting
2. An optional redacted screenshot gives the model layout awareness for icon-only controls, custom UIs, canvas-heavy apps, and cross-origin regions
3. The broker uses the screenshot for spatial understanding and the DOM for precise field values and action grounding

**Why it matters:**

- Lets Emma operate real browser workflows with natural language
- Keeps the active tab as the primary task context instead of drifting into detached chat answers
- Reuses the same Emma agent platform primitives users already configure in the main app

---

### ContextX Knowledge System

**ContextX** is Emma's knowledge ingestion and retrieval system. It turns files and URLs into reusable, structured knowledge groups that agents can query during chat.

It is more than simple file upload. ContextX builds a versioned, retrieval-ready knowledge index with document structure, metadata, section graphs, contextual chunk summaries, section embeddings, chunk embeddings, image embeddings, and calibrated retrieval.

**Architecture at a glance:**

- **Storage model**: PostgreSQL is the source of truth for documents, versions, sections, chunks, images, and retrieval settings.
- **Semantic retrieval**: `pgvector` stores dense embeddings for document metadata, sections, chunks, and image text.
- **Lexical retrieval**: PostgreSQL full-text search is combined with `pg_trgm` similarity so multilingual and imperfect keyword matches still have a path.
- **LLM stages**: LLMs are used selectively for parse/repair, metadata extraction, contextual chunk enrichment, and image understanding.
- **Reliability model**: reingest and cancel operate on a pending version and preserve the last good active version until a new version is successfully finalized.

**What gets indexed:**

- **Document metadata**: title, summary-style metadata, and a metadata embedding used for document shortlisting.
- **Sections**: heading path, summary, page span, and a section embedding used for hierarchical retrieval.
- **Chunks**: chunk text plus contextual enrichment, overlap, and the main embedding searched at answer time.
- **Images**: caption or extracted text, page references, and embeddings so screenshots/figures can be retrieved alongside text.

#### Embedding + Ingestion Flow

```mermaid
flowchart TD
  A["Upload / URL / Inline Markdown"] --> B["runIngestPipeline"]
  B --> C["Extract file into markdown or page text"]
  C --> D{"LLM parse / repair enabled?"}
  D -->|Yes| E["Parse model rewrites into cleaner markdown"]
  D -->|No| F["Use deterministic extracted markdown"]
  E --> G["Normalize headings, pages, and links"]
  F --> G
  G --> H["Extract document metadata"]
  H --> I["Build section graph"]
  I --> J["Chunk content with overlap rules"]
  J --> K["LLM context enrichment per chunk"]
  I --> L["Prepare section embedding text"]
  J --> M["Prepare chunk embedding text"]
  G --> N["Prepare image OCR / caption text"]
  H --> O["Embed metadata text"]
  L --> P["Embed sections"]
  M --> Q["Embed chunks"]
  N --> R["Embed images"]
  O --> S["Persist document row"]
  P --> T["Persist section rows"]
  Q --> U["Persist chunk rows"]
  R --> V["Persist image rows"]
  S --> W["Write version snapshot"]
  T --> W
  U --> W
  V --> W
  W --> X["Promote pending version to active version"]
  X --> Y["Document remains ready for retrieval"]
```

**Ingestion notes:**

- If the document is brand new, failure marks the document as `failed`.
- If the document already has an active version, reingest failure or cancel only clears the pending processing state and keeps the live document `ready`.
- Bulk ingest embeddings are computed in batches; only single query-time embeddings use the in-process LRU/TTL cache.

#### Hierarchical Retrieval Flow

```mermaid
flowchart TD
  A["User / Agent query"] --> B["Unicode-aware tokenization + conservative query expansion"]
  B --> C["Embed query variants"]
  C --> D["Document metadata retrieval"]
  D --> D1["Lexical: tsvector + pg_trgm"]
  D --> D2["Vector: pgvector metadata embedding"]
  D1 --> E["Document shortlist"]
  D2 --> E
  E --> F["Section retrieval within shortlisted docs"]
  F --> F1["Lexical: section heading / summary search"]
  F --> F2["Vector: section embedding search"]
  F1 --> G["Section shortlist"]
  F2 --> G
  G --> H["Chunk retrieval constrained to shortlisted sections"]
  H --> H1["Lexical chunk search"]
  H --> H2["Vector chunk search"]
  G --> I{"No strong sections?"}
  I -->|Yes| J["Fallback to doc-scoped chunk retrieval"]
  I -->|No| K["Keep section-scoped chunk retrieval"]
  J --> L["Fuse chunk candidates"]
  K --> L
  H1 --> L
  H2 --> L
  L --> M["Compute calibrated confidence score"]
  M --> N{"Reranker configured?"}
  N -->|Yes| O["LLM rerank on shortlisted chunks"]
  N -->|No| P["Use calibrated score directly"]
  O --> Q["Final top chunks"]
  P --> Q
  Q --> R["Attach inline previous / next neighbor context"]
  Q --> S["Image retrieval inside matched docs"]
  S --> S1["Image lexical + vector candidates"]
  S1 --> S2["Rescore by section heading overlap + page proximity"]
  R --> T["queryKnowledgeAsDocs / knowledge tool output"]
  S2 --> T
  T --> U["Grounded answer generation"]
```

**How the database participates:**

- **`pgvector`** is used for cosine-similarity search over metadata, sections, chunks, and images.
- **PostgreSQL full-text search** remains the precision-oriented lexical arm.
- **`pg_trgm`** adds fuzzy similarity and multilingual fallback when stemming or exact tokenization would miss.
- The retriever merges these signals into a calibrated confidence score instead of using only relative rank.

**Ranking behavior:**

- Retrieval is hierarchical: **document shortlist -> section shortlist -> chunk retrieval -> optional rerank**.
- Recall depth adapts to the query size instead of using one fixed candidate count.
- Neighbor chunks are no longer separate zero-score hits; they are attached as inline context to the winning chunks.
- Image matches are tied back to the same section/page neighborhood so diagrams and screenshots stay aligned with the textual evidence.

**How it works in the product:**

- Knowledge is grouped into **ContextX groups**
- Groups define embedding model, reranker, threshold, and linked source scopes
- Agents can use those groups as private knowledge memory
- The system can also expose knowledge groups through MCP-style access patterns for broader tool use

**Why it matters:**

- Produces cleaner retrieval than naive chunk-and-embed pipelines
- Preserves structure from long documents instead of flattening everything into raw text blobs
- Keeps live knowledge available during reingest instead of taking good documents offline
- Gives Emma agents a durable knowledge layer for company docs, product docs, SOPs, manuals, and internal research

---

### Visual Workflows

Build node-based workflows that become callable tools in chat.

- **LLM nodes** — AI reasoning steps
- **Tool nodes** — MCP tool execution steps
- Connect nodes to create multi-step automated sequences
- Publish a workflow to make it available as `@workflow_name` in chat
- Chain complex processes into reusable, shareable automations

---

### MCP Tool Integration

Full support for the [Model Context Protocol](https://modelcontextprotocol.io/introduction).

- Connect any MCP server (local or remote)
- Tools from MCP servers automatically appear in the tool selector
- Use `@mcp("server_name")` in chat to scope a message to specific MCP tools
- Browser automation example with [playwright-mcp](https://github.com/microsoft/playwright-mcp):

```prompt
Using @mcp("playwright"):
- Navigate to https://www.google.com
- Click the search bar and type "model context protocol"
- Take a screenshot
```

---

### @mention & Tool Presets

Type `@` in any chat input to instantly invoke tools, agents, or workflows.

- **`@tool_name`** — Temporarily bind specific tools for that message only (saves tokens, improves accuracy)
- **`@agent_name`** — Switch to a custom agent for the response
- **`@workflow_name`** — Run a published workflow as a tool

**Tool Presets** let you save named groups of tools and switch between them instantly — useful for organizing tools by task type (e.g., "research mode", "coding mode").

**Tool Selection** (persistent) vs **@mentions** (per-message):

- Use **Tool Selection** to keep frequently needed tools always available across all chats
- Use **@mentions** to temporarily scope a message to specific tools without cluttering the model's context

---

### Tool Choice Mode

Control how the model uses tools in each chat. Switch anytime with `Cmd+P`.

| Mode       | Behavior                                           |
| ---------- | -------------------------------------------------- |
| **Auto**   | Model calls tools when it decides they're needed   |
| **Manual** | Model asks your permission before calling any tool |
| **None**   | Tool usage is completely disabled                  |

---

### Built-in Tools

**Web Search** — Powered by [Exa AI](https://exa.ai)

- Semantic web search and URL content extraction
- Free tier: 1,000 requests/month (no credit card required)
- Enable by adding `EXA_API_KEY` to `.env`

**Image Generation**

- Generate and edit images directly in chat
- Supported models: OpenAI, Google Gemini, xAI

**JS & Python Executor**

- Run JavaScript or Python snippets inline within the conversation

**Data Visualization**

- **Interactive tables** with sorting, filtering, search, column visibility, CSV/Excel export, and pagination
- **Charts** — bar, line, pie, and more via built-in chart tools

**HTTP Client** — Make API requests directly from chat

---

### Voice Assistant

A realtime voice-based assistant powered by OpenAI's Realtime API, extended with full MCP tool integration.

- Talk naturally — the assistant listens and responds in real time
- Full access to all configured MCP tools during voice sessions
- Watch tool execution happen live while the conversation continues

---

## Guides

Step-by-step setup guides for specific topics:

| Guide                                                                                      | Description                                               |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [MCP Server Setup & Tool Testing](./docs/tips-guides/mcp-server-setup-and-tool-testing.md) | Add and configure MCP servers                             |
| [Docker Hosting](./docs/tips-guides/docker.md)                                             | Self-host with Docker including environment setup         |
| [Vercel Hosting](./docs/tips-guides/vercel.md)                                             | Deploy to Vercel in a few clicks                          |
| [File Storage Drivers](./docs/tips-guides/file-storage.md)                                 | Configure Vercel Blob or S3 for uploads                   |
| [System Prompts & Customization](./docs/tips-guides/system-prompts-and-customization.md)   | Custom system prompts, user preferences, MCP instructions |
| [OAuth Sign-In Setup](./docs/tips-guides/oauth.md)                                         | Google, GitHub, and Microsoft login configuration         |
| [Adding OpenAI-Compatible Providers](docs/tips-guides/adding-openAI-like-providers.md)     | Connect any OpenAI-compatible API endpoint                |
| [E2E Testing Guide](./docs/tips-guides/e2e-testing-guide.md)                               | Playwright tests, multi-user scenarios, CI/CD integration |

---

## Tips

**[Temporary Chat Windows](./docs/tips-guides/temporary_chat.md)** — Open lightweight popup chats for quick questions or testing without affecting your main thread.

---

## Roadmap

- [x] File Upload & Storage (Vercel Blob)
- [x] Image Generation
- [x] Agent-to-Agent (Sub-Agents)
- [x] A2A Federation
- [x] Snowflake Intelligence Agents
- [x] Emma Pilot Browser Copilot
- [x] ContextX Knowledge System

---

## Contributing

All contributions are welcome — bug reports, feature ideas, and code improvements.

> **Read the [Contributing Guide](./CONTRIBUTING.md) before submitting a PR or Issue.**

**Translations:** Help make the chatbot accessible in more languages. See [language.md](./messages/language.md) for instructions.

---

## Support

If this project has been useful to you:

- Star this repository
