# ADR 0001: Transactional PostgreSQL rotation engine

Status: accepted

## Context

Two devices can attempt to assign the same employee while queues, qualifications,
and availability are changing. A browser-only algorithm could produce duplicate
or unexplained outcomes.

## Decision

PostgreSQL is the source of truth. Rotation-changing operations run in database
functions that authorize the actor, lock/validate the expected state version,
update projections, and append events in one transaction. The system maintains a
master rotation plus a shared haircut rotation because salon policy advances
haircuts independently while dollar credits accumulate toward a $30 full turn.

## Consequences

Concurrency behavior is deterministic and auditable. SQL is more substantial,
but business invariants remain enforceable across every client.
