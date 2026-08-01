# ADR 0003: AWS Amplify Hosting for Next.js

Status: accepted

## Context

The application needs managed HTTPS hosting, Git-based deployments, preview
builds, and support for Next.js App Router server rendering.

## Decision

Deploy the web application through AWS Amplify Hosting while Supabase remains
the primary backend. Configure only the public Supabase URL and publishable key
in Amplify; private credentials remain in Supabase Edge Function secrets.

## Consequences

This adds genuine AWS deployment experience without duplicating the database or
authentication stack. The frontend and backend have separate deployment paths,
so migrations and Edge Functions must be released before dependent UI changes.
