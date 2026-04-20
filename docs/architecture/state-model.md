# State Model

## Purpose

This document describes the state concepts that the contract-first refactor is
expected to preserve and clarify.

The goal is not to define exact database tables yet. The goal is to define the
persisted facts the system must remember regardless of storage implementation.

## State principles

- Persist facts, not temporary adapter details.
- Keep state independent from CLI output formatting.
- Separate execution attempts from domain facts.
- Make idempotency explicit.
- Prefer append-friendly models for runtime history.

## Core persisted facts

### Entries

Entries are normalized items collected from sources.

They represent durable content facts such as:

- identity
- origin source
- title
- URL
- timestamps
- extracted metadata

An entry is not "a notification". It exists whether or not any hook ever runs.

### Scan runs

A scan run records that collection work happened for a pipeline or source set.

It should answer questions like:

- when was this pipeline scanned
- did the scan succeed or fail
- how many entries were discovered
- what error occurred

Scan runs are execution history for collection, not hook execution history.

### Events

Events are persisted, immutable facts emitted by the runtime.

Typical event kinds:

- `entry.discovered`
- `scan.completed`
- `scan.failed`
- `batch.ready`

Persisting events separately matters because:

- hooks can retry without inventing new facts
- multiple hooks can react to the same fact
- auditability improves
- batch workflows become explicit

### Hook runs

Hook runs record attempted reactions to events.

They should be separate from events because one event may produce:

- zero hook runs
- one hook run
- many hook runs
- retries for the same hook

This separation keeps hook failure from mutating the meaning of the original
event.

### Batch windows

Batch windows record how a pipeline groups work over time.

They make scheduled aggregation explicit and inspectable:

- when a window opened
- when it closed
- which events or entries it includes
- whether hooks have already reacted to it

## Idempotency

Idempotency must be a first-class state concern.

Examples:

- entry identity should prevent the same article from being inserted repeatedly
- event identity should let multiple retries refer to the same fact
- hook execution identity should prevent duplicate side effects for the same
  `event + hook` pair

The exact storage keys may evolve, but the state model must make those
guarantees possible.

## Minimal conceptual stores

The runtime is expected to grow toward the following conceptual stores:

- workspace configuration state
- source registry state
- entry state
- scan run state
- event state
- hook run state
- batch window state
- scheduler runtime state

These names are conceptual. They do not require one table per concept.

## What this model avoids

This model intentionally avoids:

- storing hook output as if it were the event itself
- coupling event persistence to a specific notification mechanism
- making runtime meaning depend on filesystem layout
- encoding adapter-specific row shapes in top-level contracts

## Current repository stance

The existing SQLite schema remains valid for the current runtime. This document
does not replace it yet.

Instead, it establishes the direction for future state refactors so schema work
can move with a clear conceptual model.
