# Contract-First Architecture

## Purpose

This document defines the architectural baseline for the next phase of
`feeds-cli`.

The immediate goal is not to rewrite the runtime. The goal is to make the
future refactor direction explicit inside the repository so new code has a
clear source of truth.

## Core principles

- Separate concerns aggressively.
- Separate state from logic.
- Prefer explicit contracts over implicit conventions.
- Keep adapters replaceable.
- Treat runtime behavior as an implementation detail behind stable contracts.

## Layer model

The target architecture is organized into four layers.

### 1. Contracts

Contracts define the public vocabulary of the system:

- pipeline specs
- event envelopes
- hook specs
- scheduler ports
- shared primitives and identifiers

Contracts are the most stable layer. They define what the system means, not
how it is implemented.

### 2. State

State represents persisted facts:

- entries that were collected
- scan runs that happened
- events that were emitted
- hook runs that were attempted
- batch windows that were opened or closed

State does not own behavior. It should be possible to understand persisted
state without reading orchestration code.

### 3. Logic

Logic implements use cases and orchestration:

- collect sources
- normalize entries
- persist facts
- plan events
- dispatch hooks
- open and close batches

Logic depends on contracts and state ports, not on concrete runtimes such as
SQLite, Bun.cron, or the CLI.

### 4. Adapters

Adapters connect the abstract model to the outside world:

- CLI commands
- SQLite repositories
- filesystem-backed config stores
- hook runners
- Bun.cron scheduler integration
- HTTP/feed fetchers

Adapters are intentionally replaceable. They should be cheap to regenerate as
long as contracts remain stable.

## Dependency direction

The allowed dependency direction is:

`contracts <- state <- logic <- adapters`

In practice:

- `contracts` depend on nothing inside the app
- `state` may depend on `contracts`
- `logic` may depend on `contracts` and abstract state ports
- `adapters` may depend on any lower layer to implement ports or expose entry
  points

The reverse direction is not allowed:

- contracts must not depend on adapter details
- logic must not depend directly on SQLite row shapes or Bun.cron APIs
- state models must not depend on CLI formatting behavior

## Why contract-first

The current codebase is intentionally pragmatic and runtime-first. That is
reasonable for a PoC, but it mixes concerns:

- config contracts and runtime types live in the same file
- orchestration logic is close to CLI entry points
- domain logic can see concrete persistence types

Moving to a contract-first model gives the refactor a stable backbone without
forcing a large runtime rewrite up front.

## Migration stance

This repository is allowed to change aggressively. Backward compatibility is
not the goal right now.

Even so, migration should still be disciplined:

1. Define contracts first.
2. Introduce state boundaries next.
3. Move orchestration into logic modules.
4. Replace direct adapter coupling with ports.
5. Remove legacy structures only after their contract-backed replacement
   exists.

## Current repository status

At the time this document was introduced:

- `src/types.ts` still contains mixed concerns
- runtime code still uses direct adapters in many places
- contract files are added as the canonical design target, not as a full
  runtime integration yet

That is intentional. The repository should first learn the new vocabulary,
then move runtime code toward it.
