# Design Overview

## Purpose

This memo is the easiest entry point for the current design direction of
`feeds-cli`.

It does not try to define every contract or every persistence detail. Instead,
it records the main architectural judgments that shape the product so future
changes can stay aligned.

For more detailed documents, see:

- `docs/architecture/contract-first.md`
- `docs/architecture/pipeline-runtime.md`
- `docs/architecture/state-model.md`
- `docs/adr/0001-feed-driven-event-runtime.md`

## What `feeds-cli` is

`feeds-cli` is not delivery-first.

It is a feed-driven event and hook runtime.

That means the product is centered on this flow:

1. collect data from sources
2. normalize and persist entries as durable facts
3. emit explicit events from those facts
4. run first-class hooks in response to those events

Sending notifications is one important use case, but it is only one possible
hook outcome. The same system should also support writing Markdown, updating
local indexes, triggering downstream automation, or other workflows that start
from feeds.

## Why hook is first-class

Hook is not a side feature. Hook is the execution surface of the runtime.

If hooks are treated as secondary side effects, the design naturally collapses
into a narrow "scan and notify" model. That is too small for the intended
shape of the product.

Making hook first-class means:

- hooks are part of the core vocabulary
- hooks react to explicit events, not hidden internal callbacks
- notifications are modeled as one family of hooks
- non-notification workflows are equally natural

This keeps the system open to new uses without changing its core identity.

## Core relationship: Workspace, Pipeline, Event, Hook

The main concepts relate to each other like this:

- `Workspace`
  The unit of operational isolation. Usually one base directory.
- `Pipeline`
  The unit of runtime intent inside a workspace.
- `Event`
  An immutable fact produced by runtime activity.
- `Hook`
  A first-class execution unit that reacts to events.

In plain terms:

- a workspace contains one or more pipelines
- each pipeline watches sources and defines runtime behavior
- runtime behavior produces events such as `entry.discovered` or
  `batch.ready`
- hooks are bound to those events and perform work

This model keeps storage boundaries, runtime intent, domain facts, and side
effects separate from each other.

## What a pipeline owns

A pipeline is the unit that connects collection to hook orchestration.

A pipeline defines:

- which sources it watches
- when scans should happen
- whether entries should be processed immediately or in batches
- which hooks should react to which events

This is why pipeline is the right place for operational policy. It captures
runtime intent without overloading the workspace boundary.

## Separate collection from hook execution

Collection and hook execution must be separate responsibilities.

The product should not assume that "a successful scan immediately performs all
side effects." That coupling makes retries, batching, partial failures, and
new workflows harder to reason about.

The healthier split is:

- collection fetches sources, normalizes entries, and persists facts
- event planning records what happened in domain terms
- hook dispatch executes side effects from persisted events

This separation improves robustness because:

- scan success does not depend on hook success
- hooks can retry independently
- immediate and batch-oriented workflows share the same model
- new hook types do not force collection logic to change

## Why one workspace can host multiple pipelines

The primary design is to support multiple pipelines inside one workspace.

The reason is simple: most differences people care about are runtime policy
differences, not isolation differences.

For example:

- one feed should trigger immediate notification
- another set of feeds should be collected continuously but processed as a
  twice-daily digest

Those are different pipeline behaviors. They do not require different
workspaces.

Making multiple pipelines the main design gives several benefits:

- one shared store of normalized entries and runtime facts
- one place to inspect logs and state
- one operational environment for related workflows
- a natural way to mix immediate and batch processing

## What base dir means

`base dir` is not the way to express delivery policy.

`base dir` defines the boundary of a workspace. It scopes:

- config
- database
- logs
- runtime state
- local hook-related assets

Separate base directories are still useful, but for isolation:

- personal vs work environments
- production vs experiments
- different local credentials or assets

The main design is therefore:

- multiple pipelines inside one workspace for policy differences
- multiple workspaces only when full isolation is needed

## What Bun.cron means

Bun.cron is an adapter choice, not the center of the design.

The domain should care about scheduling needs such as:

- scan ticks
- batch ticks

It should not care about the concrete scheduler API.

In other words:

- the contract says that scheduled jobs exist
- the adapter decides that Bun.cron is the current implementation

This keeps platform-specific complexity at the edge and preserves the ability
to refactor the runtime without rewriting the domain model.

## Design stance

The working design stance for `feeds-cli` is:

- model the product as a feed-driven event and hook runtime
- keep hooks first-class
- keep collection and hook execution as separate responsibilities
- treat pipelines as the primary unit of operational policy
- treat workspaces and base directories as isolation boundaries
- keep scheduler details behind adapters such as Bun.cron
- prefer stable contracts and replaceable implementations

That combination supports both current use cases and future ones without
forcing the product into a notification-only shape.
