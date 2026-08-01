# ADR 0002: Supabase as the application backend

Status: accepted

## Context

The project needs authentication, PostgreSQL, row-level authorization, private
file storage, realtime refreshes, and server-side integration code without
operating several independent services.

## Decision

Use Supabase for PostgreSQL, Auth, RLS, Storage, Realtime, and Edge Functions.
Keep schema changes in forward-only SQL migrations and treat RLS as a mandatory
authorization boundary rather than a UI convenience.

## Consequences

The portfolio demonstrates a coherent backend and strong data security. The app
retains standard PostgreSQL semantics and can migrate away from hosted Supabase
if necessary, though Auth, Storage, and Edge Functions would need replacements.
