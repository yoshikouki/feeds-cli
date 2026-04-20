# ADR 0001: Feed-Driven Event Runtime

- Status: Accepted
- Date: 2026-04-20

## Context

`feeds-cli` started as a practical feed collection CLI. As the product evolves,
it needs a stronger architectural center that supports:

- first-class hooks
- immediate and batch-oriented workflows
- scheduler isolation behind adapters
- aggressive refactoring without losing design clarity

The previous mental model risked over-centering delivery and treating hooks as
secondary side effects.

## Decision

`feeds-cli` is defined as a feed-driven event and hook runtime.

This implies:

- hook is a first-class concept
- delivery is a common hook outcome, not the base abstraction
- base directories define workspace boundaries
- pipelines define operational intent from scan through hook orchestration
- scheduler integration is adapter-specific and initially expected to use
  Bun.cron

## Consequences

### Positive

- The design can support notifications, Markdown generation, local automation,
  and future workflows under one model.
- Contracts can be defined independently from adapters.
- Scan, event, and hook state can evolve into separate concerns.
- Bun.cron can remain an infrastructure choice instead of a domain dependency.

### Trade-offs

- The model introduces more explicit concepts than a simple scan-and-notify
  flow.
- Runtime code will take multiple refactor steps to align with the new
  contracts.
- Existing mixed concerns in `src/types.ts` and orchestration code will remain
  temporarily during migration.

## Follow-up

The next refactor stages should:

1. establish contract types in `src/contracts`
2. define state boundaries around entries, events, hook runs, and batches
3. move orchestration into logic modules behind adapter-independent ports
