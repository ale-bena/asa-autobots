# ASA Autobots: Cooperative Multi-Agent Deliveroo Project

Welcome to the **ASA Autobots** workspace. This repository contains the source code, tests, and documentation for a cooperative multi-agent planning delivery system developed for the Deliveroo competitive simulator.

---

## 🤖 System Architecture

The team consists of two distinct cooperating agents working in synchronization:

1. **Agent 1 — BDI Physical Executor (`run_bdi.js`)**:
   * A reactive agent driven by a **Belief-Desire-Intention (BDI)** loop running at ~60 Hz.
   * Maintains persistent spatial memory of the grid, performs negative inference when objects are no longer seen, and simulates local parcel decay.
   * Selects goals using a throttled utility cascade (Admin commands $\rightarrow$ Cooperative Contracts $\rightarrow$ Expiration-Aware Economic Utility).
   * Jointly optimizes cargo subsets and wait-time bounds via a **Delivery Stack Optimizer** to maximize policy-adjusted scores.
   * Features opportunistic pickups and deterministic collision-avoidance yielding to prevent deadlocks.

2. **Agent 2 — LLM Cognitive Coordinator (`run_llm.js`)**:
   * A cognitive reasoning agent powered by `llama-3.3-70b-lmstudio`.
   * Listens to Admin instructions, decomposes multi-task requests sequentially, resolves math expressions via an arithmetic tool, and enforces feasibility gates (verifying positive rewards before acting).
   * Mutates local beliefs and propagates policy rules, holds/resumes, and coordinates contracts to the Executor via P2P messages.

3. **PDDL Symbolic Planner (`src/planning/PddlServiceBridge.js`)**:
   * Integrates a symbolic planning layer (`deliveroo-crates` domain) written in STRIPS PDDL.
   * Triggered exclusively as a fallback tier when a path is blocked by pushable crates, producing sequential move-and-push sequences to clear the corridor.

---

## 🛠️ Project Setup

This is a modern ES Modules Node.js project.

### 1. Prerequisites
* **Node.js** (version 18 or higher recommended)
* Optional: A local PDDL solver running on `http://localhost:5001` (for fast crate-clearing resolution)
* Optional: LM Studio running `llama-3.3-70b` (for LLM coordination)

### 2. Install Dependencies
Run the following command in the root folder to set up the project:
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the project root to declare your socket host, agent tokens, and LLM configuration (see `.env.example` as a template).

---

## 🚀 Execution Scripts

Define the agent behaviors and run them with the following npm scripts:

### Run Agents
* **BDI Executor (Agent 1)**:
  ```bash
  npm run bdi
  ```
* **LLM Coordinator (Agent 2)**:
  ```bash
  npm run llm
  ```

### Run Performance Benchmark
Runs 3 concurrent agents for 15 seconds to measure move counts, pickups, drops, and collisions, providing a tabular stats report:
```bash
npm run benchmark
```

### Run Test Suite
Executes all 203 unit tests (incorporating belief revisions, P2P managers, policy optimization, pathfinding, and PDDL integration):
```bash
npm test
```

---

## 📖 Project Specification & Documentation Hub

A complete static SPA Documentation Hub is included in the `/docs` folder. 

### Local Preview
To run the lightweight, zero-dependency local documentation server and preview the site locally, execute:
```bash
npm run doc
```
Then visit: **[http://localhost:3000](http://localhost:3000)**

### Production / Online
The documentation hub is fully independent of Node.js servers and is configured to compile markdown and render Mermaid diagrams directly in the browser. It is published online via **GitHub Pages**:
👉 **[https://ale-bena.github.io/asa-autobots/](https://ale-bena.github.io/asa-autobots/)**
