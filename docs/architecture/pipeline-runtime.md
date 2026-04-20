# Pipeline Runtime Model

## Purpose

This document defines the intended runtime model for `feeds-cli`.

The system is not delivery-first. It is a feed-driven runtime that collects
entries, records facts, emits events, and executes first-class hooks.

Notifications are an important use case, but they are only one possible hook
behavior among many others such as writing Markdown, updating indexes, or
driving downstream automation.

## Core concepts

### Workspace

A workspace is the unit of operational isolation.

A workspace is typically rooted at one base directory and owns:

- config
- database
- logs
- scheduler runtime state
- hook-related local assets

`base dir` is therefore a workspace boundary, not a delivery policy switch.

### Source

A source is an input that can be collected, such as:

- RSS
- Atom
- JSON Feed
- scraped HTML
- future pull-style protocols

Sources describe where entries come from.

### Entry

An entry is the normalized fact collected from a source.

Entries are the stable data model that downstream workflows react to. Hooks do
not consume transport-specific feed payloads. They consume normalized facts or
events derived from those facts.

### Pipeline

A pipeline is the operational unit that binds together:

- the sources it watches
- how scans are scheduled
- whether batching is used
- which hooks should react to which events

Pipelines own end-to-end runtime intent from collection through hook
orchestration.

### Event

An event is an immutable fact derived from runtime activity.

Examples:

- `entry.discovered`
- `scan.completed`
- `scan.failed`
- `batch.ready`

Events are durable and explicit. They are not a side effect of hook execution.

### Hook

Hooks are first-class runtime units.

Hooks react to events and perform work such as:

- send a notification
- write a Markdown digest
- call another process
- update another local or remote system

The hook model is intentionally more general than "delivery".

### Batch

Batching groups entries or events into a later processing window. A batch is a
pipeline concern, not a special notification subsystem.

This allows immediate and scheduled workflows to coexist under the same model.

## Runtime flow

The target runtime flow is:

1. A scheduler triggers a scan tick for a pipeline.
2. The collector fetches the pipeline's sources.
3. Entries are normalized and persisted.
4. Domain events are emitted and persisted.
5. Hook dispatch plans executions from those events.
6. Hooks run independently with their own execution records.

For batch-oriented pipelines:

1. Entries continue to be collected on scan ticks.
2. Events accumulate inside the workspace state.
3. A batch tick closes a window or selects a pending set.
4. A `batch.ready` event is emitted.
5. Hooks react to that event.

## Why delivery is not the base concept

If the system were modeled around delivery, it would naturally privilege
"send something somewhere" over other valid automations.

That would make several real workflows feel secondary:

- write selected entries as Markdown
- generate local reading notes
- trigger a classifier or tagger
- sync items into another tool
- build a digest file without sending it anywhere

The more general base is:

- collected entries
- emitted events
- executed hooks

Delivery is then one family of hook outcomes, not the core abstraction.

## Scheduling model

Scheduling is an adapter concern. The domain only cares that certain runtime
ticks happen:

- scan ticks
- batch ticks

The first scheduler adapter is expected to use Bun.cron, but the contract must
remain scheduler-agnostic.

## Design consequences

- Hook execution should be decoupled from feed parsing details.
- Event persistence should exist independently from hook success or failure.
- Scan and hook execution should have separate state and retry behavior.
- Pipelines should be able to express both immediate and batch-oriented
  workflows without changing workspace boundaries.
