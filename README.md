# cf_ai_env_drift_analyzer

An AI-powered agent that detects, explains, and remembers behavioral differences across application environments (local, staging, beta, production) to improve developer understanding and deployment confidence.

---

## Overview

In real-world systems, the same application often behaves differently across environments.

Local development rarely reflects production reality. As applications move through staging, beta, and production, they accumulate additional layers of security, networking, and policy enforcement. These differences frequently result in unexpected latency, failed requests, or production-only bugs that are difficult to diagnose quickly.

While developers can manually investigate these issues using browser tools, logs, and metrics, doing so requires fragmented context and prior knowledge of what to look for. The result is slow debugging, repeated investigations, and environment-specific knowledge that is rarely documented or preserved.

`cf_ai_env_drift_analyzer` addresses this gap by providing an AI-powered agent that helps developers understand *why* application behavior differs across environments.

---

## What This Project Does

This project provides a single interface where developers can ask:

> “Why does this request behave differently across environments?”

Given two environments or URLs, the agent:
- Collects observable request and response signals
- Compares behavior across multiple layers, including security, routing, caching, and performance
- Explains the most likely causes of differences in clear, structured language
- Suggests concrete next steps to validate or mitigate the issue
- Remembers environment-specific behavior over time to reduce repeated analysis

Rather than replacing traditional observability tools, this project focuses on **explainability and developer understanding**.

---

## Why an AI Agent?

Differences between environments are rarely caused by a single factor.

A production request may behave differently due to a combination of:
- Security enforcement triggering preflight requests
- Redirect chains introduced by edge configuration
- Authentication flows altering request shape
- Cache policies varying by environment

These causes are often multi-layered, context-dependent, and difficult to express using fixed rules.

This project uses an AI agent to:
- Reason over incomplete or partial signals
- Form hypotheses about likely root causes
- Explain trade-offs and side effects in plain language
- Adapt explanations using historical context

The goal is not full automation, but faster and more reliable understanding for developers.

---

## Architecture Overview

This project is built using Cloudflare’s edge-native platform:

- **Cloudflare Pages**  
  Provides a simple chat-based interface for developer interaction.

- **Cloudflare Worker**  
  Acts as the API and agent entry point, routing requests and invoking Workers AI.

- **Workers AI (Llama 3.3)**  
  Performs reasoning, explanation generation, and recommendation synthesis.

- **Cloudflare Workflows**  
  Coordinates multi-step analysis, including:
  - Signal normalization
  - Environment comparison
  - Hypothesis generation
  - Explanation synthesis

- **Durable Objects**  
  Store environment-specific memory and historical comparisons, allowing the agent to retain knowledge over time.

---

## Memory and State

Each application environment is represented by a Durable Object.

The agent stores:
- Previously observed behavior
- Known environment-specific constraints
- Past comparisons and conclusions

This allows the system to:
- Avoid repeating analysis
- Surface known differences immediately
- Accumulate institutional knowledge similar to an internal runbook

---

<img width="2248" height="1614" alt="image" src="https://github.com/user-attachments/assets/6898ba9c-dd90-4400-94d2-99a2f3943b56" />

---

## Example Use Case

A developer deploys a new version of an API.

- Requests succeed locally and in staging
- Production requests are slower and occasionally fail

The developer asks the agent to compare staging and production.

The agent determines:
- Production introduces an additional redirect and a CORS preflight request
- A security header injected only in production triggers the preflight
- The preflight adds an extra network round trip, increasing latency
- Staging does not enforce the same rule

The agent suggests:
- Adjusting request headers to avoid preflight
- Or aligning staging security policies to better match production

The developer now understands *why* the behavior differs, not just *that* it differs.

---

## How to Run Locally
```bash
npm run dev
npm run dev:ui
