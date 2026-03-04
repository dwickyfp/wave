# ContextX Engine – Comprehensive Planning Strategy

**Version 1.0** | **Date:** March 2026  
**Author:** Grok (Vercel AI SDK Team)  
**Goal:** Build a fully self-hosted, private, production-grade internal RAG + MCP engine that **outperforms Context7** in accuracy, privacy, comprehensiveness, and extensibility.

---

## 1. Vision & Objectives

**Mission**  
Deliver instant, ultra-accurate access to **all** internal company knowledge (codebases, docs, wikis, PDFs, Notion, Confluence, architecture diagrams, APIs, etc.) directly inside every AI coding tool (Cursor, Claude Desktop, Windsurf, VS Code + Continue, etc.).

**Key Success Metrics (v1.0)**

- Retrieval Precision@10 ≥ **95%** (Context7 ≈ 80%)
- End-to-end P95 latency < **800 ms**
- **100% data residency** inside company VPC / private network
- Scale to 50+ repositories + 10,000+ documents
- Zero external vendor lock-in (optional cloud models only for embeddings/reranking)

---

## 2. Differentiators vs Context7

| Feature                      | Context7              | InternalContext (Target)                                              | Gain             |
| ---------------------------- | --------------------- | --------------------------------------------------------------------- | ---------------- |
| Data Privacy                 | Upstash cloud         | 100% on-prem / VPC                                                    | Complete         |
| Sources                      | Public libraries only | All private + public (Git, PDFs, Notion, Confluence, etc.)            | Unlimited        |
| Retrieval Architecture       | Basic + proprietary   | Hybrid (BM25 + vector) + Reranker + Contextual Retrieval + LLM filter | +20–35%          |
| Chunking                     | Generic               | Hierarchical + Code-aware (tree-sitter) + Semantic + Parent-document  | +15–25%          |
| MCP Compatibility            | Yes                   | Native AI SDK v6 + extended tools                                     | Seamless         |
| Versioning & Change Tracking | Limited               | Full Git semantic versioning + diff highlighting                      | Superior         |
| Access Control               | None                  | Full RBAC + per-team/per-user                                         | Enterprise-ready |
| Cost                         | Subscription          | Only your infrastructure cost                                         | Free after setup |

---

## 3. High-Level Architecture

AI Editors (Cursor / Claude / Windsurf / VS Code)
↓ MCP (HTTP + OAuth2)
[InternalContext MCP Server] ── AI SDK v6
├── resolve-doc-source
├── query-context (hybrid + rerank)
├── get-full-section
└── list-sources / add-source
↓
Ingestion Pipeline (BullMQ workers)
→ Parsers → LLM Contextual Enricher → Smart Chunker → Embedder
↓
Postgres (metadata + Prisma) + pgvector
MinIO/S3 (raw files)

---

## 4. Tech Stack (Privacy-First 2026)

| Layer         | Primary Choice                      | Local / Fallback Option          | Reason               |
| ------------- | ----------------------------------- | -------------------------------- | -------------------- |
| Runtime       | Node.js 22 + TypeScript + AI SDK v6 | —                                | Native MCP & rerank  |
| MCP Framework | `@ai-sdk/mcp`                       | —                                | Official             |
| Vector DB     | PostgreSQL 17 + pgvector 0.7        | Qdrant (Docker)                  | Hybrid search + ACID |
| Embeddings    | OpenAI `text-embedding-3-large`     | `nomic-embed-text-v1.5` (Ollama) | Highest accuracy     |
| Reranker      | Cohere `rerank-v3.5`                | `bge-reranker-large` / FlashRank | +20–30% precision    |
| Parser        | Unstructured.io + tree-sitter       | llama-parse                      | Tables, code, images |
| Queue         | BullMQ + Redis                      | —                                | Reliable jobs        |
| File Storage  | MinIO (S3-compatible)               | —                                | Private              |
| ORM           | Prisma                              | Drizzle                          | Type-safe            |
| Deployment    | Docker Compose → Kubernetes         | —                                | Easy dev → prod      |

---

## 5. High-Accuracy Retrieval Pipeline (Core Engine)

1. **Query Expansion** (HyDE + Multi-Query – optional)
2. **Hybrid Search** → fetch top 60 candidates (BM25 + vector)
3. **Contextual Retrieval** (pre-computed LLM summaries)
4. **Reranking** (`rerank-v3.5`) → top 12
5. **LLM Relevance Filter** (score > 0.85)
6. **Context Compression** (optional)
7. **Final context** with citations

**Ingestion Enhancements**

- Hierarchical chunking (500–800 tokens + 20% overlap)
- Parent-document indexing
- Code-aware splitting (functions, classes via tree-sitter)
- Auto-metadata + LLM-generated section summaries

---

## 6. Phased Development Roadmap (10 weeks total)

**Phase 0 – Foundation (2 weeks)**

- Docker Compose full stack
- Basic ingestion CLI
- MCP server skeleton

**Phase 1 – Core RAG (3 weeks)**

- Hybrid + reranker pipeline
- Smart chunking + contextual enrichment
- Working `query-context` MCP tool

**Phase 2 – Sources & Intelligence (3 weeks)**

- Git webhook auto-ingest
- tree-sitter code parser
- Notion / Confluence / PDF connectors
- RBAC + versioning

**Phase 3 – Production (2 weeks)**

- RAGAS evaluation suite
- Monitoring + caching
- Full docs + `llms.txt` generator
- One-click deploy

---

## 7. Security & Compliance

- TLS 1.3 + optional mTLS
- OAuth2 / OIDC authentication
- Postgres Row-Level Security
- Full audit logging
- Air-gapped mode (fully local models)

---

## 8. Evaluation Strategy

- Weekly automated benchmarks (100 internal questions)
- Metrics: Precision@5/10, NDCG, Latency, Cost
- Human feedback loop inside IDE
- Continuous A/B testing of chunking/reranker strategies

---

## 9. Deployment Options

1. **Single Docker Compose** (teams < 50)
2. **Kubernetes Helm chart** (enterprise)
3. **Vercel / Railway** (if partial cloud OK – data still private)

---

## 10. Immediate Next Steps

1. Confirm your primary sources (Git repos, Notion, PDFs, Confluence, etc.)
2. Choose vector DB (pgvector recommended)
3. Decide embedding/reranker policy (cloud OK or fully local?)
4. Create private GitHub repo

**I will instantly generate:**

- Full `docker-compose.yml`
- Prisma schema
- Complete MCP server
- Ingestion worker
- High-accuracy retrieval module

---

**This is the gold-standard ContextXengine for 2026.**

Save this file as:  
**`internal-context-planning.md`**

Ready to build? Just reply with your answers to the 3 questions above and I’ll deliver the complete starter repository in the next message.
