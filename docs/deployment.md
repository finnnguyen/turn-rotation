# Deployment and operations runbook

## Current production environment

- Amplify URL: <https://main.d1fp0wl4mlqx0q.amplifyapp.com>
- Amplify region: `us-west-2`
- Supabase project reference: `fwlnubnlbmldanqyakdy`
- Deployment branch: `main`
- Cost monitoring: account-wide zero-spend AWS budget alert

The initial production release and smoke test completed successfully. Keep
credentials, access keys, and service-role secrets out of this document and the
repository.

## Release order

1. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`, and
   `npm run build`.
2. Link the intended Supabase project and inspect `supabase db push --dry-run`.
3. Apply database migrations with `supabase db push`.
4. Set Edge Function secrets and deploy `process-service-menu`.
5. Deploy the Next.js commit through AWS Amplify Hosting.
6. Verify login, opening a workday, a test assignment, history, and a Textract
   draft review in the deployed environment.

## AWS Amplify Hosting

1. In Amplify, create an app from the GitHub repository and select the production
   branch.
2. Keep the detected Next.js build command (`npm run build`) and artifact settings.
   The committed `amplify.yml` uses `.next` as the SSR artifact directory and
   writes only `NEXT_PUBLIC_` configuration into `.env.production`, as required
   for Amplify's Next.js server runtime.
3. Add these environment variables:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

4. Never add a Supabase secret/service-role key or AWS access key to variables
   prefixed with `NEXT_PUBLIC_`.
5. Add the Amplify production and preview URLs to Supabase Auth redirect URLs.
6. Enable pull-request previews only for branches that use a non-production
   Supabase environment or read-only demo data.

## Edge Function secrets

Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` with
`supabase secrets set`. The IAM principal should allow only the Textract action
used by the function. Rotate a credential immediately if it appears in a log,
screenshot, shell history, commit, or browser-visible environment.

## Backup and recovery

- Enable Supabase automated backups for production and confirm the retention
  period before launch.
- Before a risky migration, create a logical backup with `supabase db dump` and
  store it encrypted outside the repository.
- Test restoration into a separate project. A backup is not verified until it
  has been restored successfully.
- Storage objects and database rows have separate recovery paths; include the
  private `service-menu-imports` bucket in the backup plan if original images
  must be retained.
- Prefer forward fixes and compensating business events. Never rewrite ledger or
  audit history to repair an operational mistake.

## Rollback

- Amplify can redeploy the last successful frontend build.
- Database migrations are forward-only; deploy a corrective migration rather
  than editing an applied migration.
- Disable the Textract import navigation or Edge Function if AWS integration
  fails; core rotation operations remain independent.

## Post-deployment checks

- HTTPS and PWA manifest load successfully.
- Anonymous users are redirected from workspace routes.
- Manager and staff RLS boundaries hold.
- Two assignment attempts cannot commit the same turn.
- Offline mode blocks commands and shows only aggregate cached counts.
- Textract creates drafts but never publishes automatically.
