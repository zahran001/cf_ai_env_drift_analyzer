# Documentation Map — cf_ai_env_drift_analyzer

This file serves as a high-level index and mental model for all the documentation in this repository. It explains how the different documents relate to each other, why they exist, and where a reader should look for specific information.

---

## 1. Core Architecture & Scope

These documents define **what** the system does and **how** it is built. They are the authoritative source of truth for the project's design and scope boundaries.

### [Backend_System_Architecture.md](Backend_System_Architecture.md)

The comprehensive backend system design. Covers goals and non-goals, the Cloudflare primitive stack (Workers, Workflows, Durable Objects, Workers AI), logical module boundaries (`providers/`, `analysis/`, `llm/`, `storage/`, `workflows/`, `api/`), the SQLite schema, the full Workflow step-by-step pipeline, data flow rules, error handling strategy, and extensibility points for Phase 2.

**Read this first** to understand how the backend fits together end-to-end.

### [MVP_FEATURE_SET.md](MVP_FEATURE_SET.md)

Defines the finalized MVP scope and the deliberate refinements made to balance scope, extensibility, and delivery speed. Lists core architectural contracts (SignalEnvelope, signal providers, diff engine, LLM output), what is in-scope for the MVP, and what is explicitly deferred to Phase 2.

**Read this** to understand *why* certain features exist (or don't) and where the line was drawn between MVP and future work.

---

## 2. Agent Rules & Protocols

These documents govern how AI-assisted development works in this repository. They enforce implementation contracts, coding standards, and workflow discipline. They exist because the project was built primarily through AI-assisted coding, and strict guardrails were necessary to maintain consistency across dozens of implementation sessions.

### [CLAUDE.md](CLAUDE.md)

The system rulebook. This is the single most important document for anyone contributing code. It defines:

- **Data contracts** — SignalEnvelope (Section 1.1), EnvDiff + DiffFinding (Section 1.2), LLM output schema (Section 1.3)
- **Platform constraints** — Workers runtime, Workflow orchestration steps, Durable Object methods, Workers AI usage rules
- **Module boundaries** — Which directories own which responsibilities, and the prohibition on cross-boundary imports between `/pages` and `/src`
- **Prohibited actions** — An explicit list of things code must never do (e.g., follow redirects automatically, cache DO stubs, skip LLM validation)
- **Code review checklists** — Backend (Section 15) and frontend (Section 16.5)
- **UI development protocol** — The spec-driven workflow for frontend work (Section 16)

All AI-assisted coding must follow this file. It overrides default behavior.

### [pages/.specify/](pages/.specify/) (Spec Kit)

The frontend-specific governance layer, referenced by CLAUDE.md Section 16. Contains three files:

- **constitution.md** — Non-negotiable technical constraints: React 19, Vite 7, CSS Modules only, `@shared/*` imports, zero `any` types, `useState` + hooks only (no Redux/Zustand)
- **spec.md** — Component contract inventory: props interfaces, type safety requirements, critical flows, and the single-expand model for findings
- **plan.md** — Phased execution plan for frontend work (Phases 3A through 3K), tracking which tasks are pending, in-progress, or completed

These files were extracted from the UI Implementation Plan to create a machine-enforceable spec that AI agents must read before writing any code in `/pages/`.

---

## 3. Implementation Plans & Verification

These documents track **how** the implementation was planned, executed, and verified. They bridge the gap between the architectural design and the actual code.

### [UI_IMPLEMENTATION_PLAN.md](UI_IMPLEMENTATION_PLAN.md)

The comprehensive plan for transforming the minimal initial App.tsx into a polished MVP frontend. Covers the phased breakdown (Phases 3A-3K), component architecture, acceptance criteria for each phase, and the relationship between frontend phases and backend readiness. The `pages/.specify/` Spec Kit was derived from this document.

### [MVP_Tracker.md](MVP_Tracker.md)

The initial frontend setup guide that established the philosophy for the React + Vite frontend on Cloudflare Pages. Prioritizes architectural contracts (shared types) and the async polling flow over visual polish. Documents the scaffolding decisions that the rest of the frontend was built on top of.

### [Phase-B4-Testing-Docs/MVP_VERIFICATION_REPORT.md](Phase-B4-Testing-Docs/MVP_VERIFICATION_REPORT.md)

End-to-end verification report confirming the backend MVP meets all contracts defined in CLAUDE.md and Backend_System_Architecture.md. Includes test results, gap analysis, and sign-off status.

### [tests/README.md](tests/README.md)

Quick reference for running backend tests: locations (`src/**/__tests__`), commands (`npm test`, targeted test files).

---

## 4. Deployment Guides

### [DEPLOYMENT.md](DEPLOYMENT.md)

Step-by-step production deployment guide. Covers the single-environment approach (no staging), Cloudflare Pages frontend deployment, same-domain routing where the UI and API share one `*.pages.dev` URL via Pages Functions acting as a service binding proxy, CORS lockdown strategy, and the unified verification process to run before each deploy.

**Read this** before deploying or when modifying the Wrangler configuration.

---

## 5. Phase-wise Documentation (Historical)

During development, each major implementation phase produced its own documentation directory. These are **archived records of the reasoning process** — the design decisions, critique cycles, debugging sessions, and refinements that shaped the final implementation.

They are not active guides. Per CLAUDE.md, archived phase docs should not be used for current implementation unless explicitly directed.

| Directory | What it covers |
|-----------|---------------|
| `Phase-B2-Docs/` | Durable Objects and SQLite schema design — decision logs, implementation roadmap, design decisions, readiness checklist |
| `Phase-B3-Docs/` | Workflow integration — design document, critique/refinement cycles, action plans |
| `Phase-B4-Docs/` | Final backend integration — implementation summary, workflow orchestration outcomes |
| `Phase-B4-Testing-Docs/` | Backend testing and hardening — gap analyses (redirect chains, cache headers, severity policy), debug sessions, fix design documents, and the MVP verification report |
| `Phase-UI-Docs/` | Frontend design and implementation — UI mockups, backend readiness assessments, component specifications, testing plans |

**What these directories contain:** Each holds a mix of design documents, decision logs, critique evaluations, debug analyses, and implementation summaries produced *during* that phase. They document the "why" behind decisions that might otherwise seem arbitrary in the final code.

**When to consult these:** When investigating why a particular implementation choice was made, or when revisiting a component that was built during a specific phase.

---

## How the Documents Relate

```
MVP_FEATURE_SET.md          "What are we building and what's out of scope?"
        |
        v
Backend_System_Architecture.md   "How does the backend work, end to end?"
        |
        +--------+
        |        |
        v        v
  CLAUDE.md    DEPLOYMENT.md
  "Rules for    "How to ship it"
   building it"
        |
        +-------------------------+
        |                         |
        v                         v
  UI_IMPLEMENTATION_PLAN.md   Phase-B*-Docs/
  "How to build the UI"       "Historical reasoning"
        |
        v
  pages/.specify/ (Spec Kit)
  "Enforceable frontend contracts"
        |
        v
  MVP_Tracker.md
  "Frontend scaffolding decisions"
```

The flow is top-down: scope decisions feed into architecture, architecture feeds into implementation rules, rules feed into phase-specific plans, and phase documentation captures the execution history.
