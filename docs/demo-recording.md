# Portfolio demonstration recording

## Target

- Length: 4–6 minutes
- Resolution: 1920×1080 or 1280×720
- Browser: production application in a clean window
- Privacy: hide bookmarks, email addresses, access keys, project IDs, and AWS or
  Supabase administration tabs

## Before recording

1. Open <https://main.d1fp0wl4mlqx0q.amplifyapp.com> and sign in as the demo
   manager.
2. Close unrelated tabs and notifications.
3. Prepare a fresh workday with several employees available.
4. Keep the salon price-list image ready for the Textract demonstration.
5. Record with macOS Screenshot (`Shift` + `Command` + `5`), select **Record
   Entire Screen**, enable the microphone under **Options**, and click **Record**.

## Narrated demonstration

### 1. Product introduction — 20 seconds

> Turn Rotation is a salon operations application that assigns customers fairly
> across a shared master rotation and an independent haircut rotation. It uses
> Next.js, Supabase, AWS Amplify, and Amazon Textract.

Show the dashboard and navigation.

### 2. Open the workday — 40 seconds

Open today’s workday and clock in three or four employees in arrival order.

> The daily queues are created from actual arrival order. Qualified haircut
> employees also join a shared haircut rotation. Every operational change is
> authorized and recorded by the database.

### 3. Explain the assignment engine — 60 seconds

Create a manicure-and-pedicure visit, show the recommendation explanation, and
assign it. Then create a men’s haircut.

> A service worth at least thirty dollars completes a full master turn. Haircuts
> use their own rotation, so the next haircut recommendation is independent of
> the previous nail assignment. The screen explains qualification, availability,
> wait time, and every skipped candidate.

### 4. Show turn accounting — 45 seconds

Complete one partial service and one full-turn service. Open **Daily history**.

> Smaller services accumulate toward a thirty-dollar turn. Men’s haircuts count
> as one third and women’s haircuts count as one half. The history shows both the
> totals and the exact service values that completed each employee’s turns.

### 5. Show fairness and auditability — 45 seconds

Open **Fairness & audit** and point to candidate explanations, skips, overrides,
or corrections.

> Managers can reconstruct why an assignment happened. Corrections are added as
> compensating events instead of deleting history, preserving an audit trail.

### 6. Demonstrate Amazon Textract — 60 seconds

Open **Import menu**, upload the sample price-list image, and show extracted
evidence and editable drafts.

> The image is stored privately and processed by a Supabase Edge Function using
> Amazon Textract. OCR results remain drafts. A manager must review and confirm
> every service before it can affect the live catalog.

Do not publish all extracted drafts during the recording. Confirm only a safely
reviewed example if needed.

### 7. Architecture and close — 30 seconds

> AWS Amplify continuously deploys the Next.js application from GitHub. Supabase
> provides PostgreSQL, authentication, row-level security, realtime updates,
> storage, and Edge Functions. An AWS budget alert monitors unexpected spending.
> The project demonstrates product discovery, transactional business rules,
> cloud deployment, security, testing, and operational auditability.

Return to the dashboard and stop the recording from the macOS menu bar.

## After recording

1. Trim the beginning and end in QuickTime Player.
2. Watch the complete video and verify that no credential or personal email is
   visible.
3. Upload it as an unlisted YouTube video or to another stable portfolio host.
4. Replace the placeholder in `docs/portfolio.md` with the public video URL.
5. Add the same URL to the GitHub repository description or README if desired.
