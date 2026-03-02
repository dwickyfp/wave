# Wave Chatbot

[![MCP Supported](https://img.shields.io/badge/MCP-Supported-00c853)](https://modelcontextprotocol.io/introduction)
[![Local First](https://img.shields.io/badge/Local-First-blue)](https://localfirstweb.dev/)
[![AI SDK](https://img.shields.io/badge/AI_SDK-v6-blueviolet)](https://sdk.vercel.ai/)
[![Discord](https://img.shields.io/discord/1374047276074537103?label=Discord&logo=discord&color=5865F2)](https://discord.gg/gCRu69Upnp)

**Wave Chatbot** is an open-source AI chatbot for individuals and teams, inspired by ChatGPT, Claude, Grok, and Gemini. Built with **[Vercel AI SDK v6](https://sdk.vercel.ai/)** and **Next.js**, it combines the best capabilities of leading AI services into a single customizable platform.

**[Live Demo](https://wave-chatbot-demo.vercel.app/)**

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

| Category          | Features                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **AI Providers**  | OpenAI, Anthropic, Google, xAI, Ollama, OpenRouter, and any OpenAI-compatible provider    |
| **Agents**        | Custom agents with system prompts, tool access, and agent-to-agent (sub-agent) delegation |
| **Tools**         | MCP protocol, web search, JS/Python execution, data visualization, image generation       |
| **Workflows**     | Visual node-based workflows as callable tools                                             |
| **Voice**         | Realtime voice assistant with full MCP tool integration                                   |
| **UX**            | `@mention` to invoke any tool, agent, or workflow instantly                               |
| **Collaboration** | Share agents, workflows, and MCP configurations with your team                            |
| **Deployment**    | One-click Vercel deploy, Docker Compose, or local setup                                   |

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
- [ ] Collaborative Document Editing (user & assistant co-editing, like OpenAI Canvas)
- [ ] RAG (Retrieval-Augmented Generation)
- [ ] Web-based Compute (via [WebContainers](https://webcontainers.io))

---

## Contributing

All contributions are welcome — bug reports, feature ideas, and code improvements.

> **Read the [Contributing Guide](./CONTRIBUTING.md) before submitting a PR or Issue.**

**Translations:** Help make the chatbot accessible in more languages. See [language.md](./messages/language.md) for instructions.

---

## Support

If this project has been useful to you:

- Star this repository
