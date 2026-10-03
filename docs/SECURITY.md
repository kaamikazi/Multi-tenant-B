# Security notes

What TenantFlow enforces, where, and what it deliberately does not do. The
README has the short version; this file is for a reviewer or for whoever takes
the demo to production.

**Rule of thumb:** the database is the security boundary. UI checks only
decide what people see.

---

## 1. Tenancy and roles

- Every public table has RLS, and every table except `tenants` has a
  `tenant_id`. A trigger stops any row moving to another tenant. The
  workspace is derived in the database from the session
  (`private.current_tenant_id()`) and is never read from the client.
- Owner, admin and member rules are RLS policies, plus checked functions
  for column-level rules: role changes and ownership transfer. Clients
  cannot write `tenants.plan`, `users.role`, `billing`, or the assistant's
  provenance columns.
- **Seat limits are re-checked when an invitation is accepted**, under a
  lock on the tenant row, against the workspace's *current* plan. A
  workspace that downgrades from Pro keeps its existing members (nobody is
  deleted). It is shown as over the limit, and invitations created while on
  Pro cannot fill it beyond the Free cap.

## 2. Automated security regression tests

`supabase/tests/database/11_meta_security.test.sql` checks the *shape* of
the schema, so a future migration that forgets a safeguard fails CI:

| Invariant | Allowlist |
|---|---|
| RLS on every public table | none |
| `tenant_id` on every table | `tenants` |
| `prevent_tenant_id_change` on every tenant table | none |
| No anon privileges on any table, view, sequence or column | none |
| Views are `security_invoker` | none |
| Every client-writable text column has a CHECK constraint | none |
| SECURITY DEFINER functions | 23 reviewed functions |
| Each definer pins `search_path = ''` | none |
| anon EXECUTE | 6 booking/invitation RPCs |
| authenticated EXECUTE | 21 reviewed functions |
| `record_assistant_message` | service_role only |
| Booking `cancel_token` not selectable by clients; members can't read invitation tokens | — |

When this suite was first run it found a real (non-exploitable) gap: two
generic trigger functions still had Postgres's default `EXECUTE` grant to
`PUBLIC`. Migration `…000012` revokes it.

The suite was also checked in reverse. Creating an insecure table, view and
SECURITY DEFINER function inside a rolled-back transaction makes 10 of its
assertions fail.

## 3. Billing (Stripe)

- **Entitlement is decided in one pure function**, `src/lib/stripe-entitlement.ts`,
  and fails closed. A subscription grants Pro only if all of these hold:
  1. it contains the TenantFlow Pro price (pinned by `STRIPE_PRO_PRICE_ID`,
     or found by the lookup key `tenantflow_pro_monthly`);
  2. its `metadata.tenant_id` matches the workspace that owns the Stripe
     customer **in our database**;
  3. its status is `active`, `trialing` or `past_due` (Stripe's retry
     window).

  Every other status, product or metadata value means Free.
- **The tenant comes from our record of who owns the customer**, never from
  event or subscription metadata alone. Webhooks, the checkout return and
  reconciliation all call the same `syncCustomer()`. That function re-reads
  every subscription of that customer from Stripe, so duplicate and
  out-of-order events converge.
- **Races:**
  - The customer is created with a per-tenant Stripe idempotency key plus a
    conditional database write, and any losing (orphan) customer is deleted.
  - Checkout re-syncs first, so an existing Pro subscription means no new
    checkout.
  - An open checkout for the tenant is reused, and new sessions use a
    10-minute idempotency key.
- **Reconciliation:** `POST /api/cron/reconcile-billing` with
  `Authorization: Bearer $CRON_SECRET`.
  - The secret is server-only and must be 32 or more characters; with no
    secret set, the route returns 404.
  - It re-syncs every workspace that has a Stripe customer, is idempotent,
    and returns counts only. Per-tenant details go to the server log.
  - `vercel.json` schedules it daily. Vercel Cron can only send GET, so GET
    is accepted with the same bearer check.
  - No-cost manual run: `npm run billing:reconcile` (or `curl -X POST` with
    the header).
- **Validated live against Stripe test mode:**
  - a real Checkout with a test card;
  - 5 concurrent upgrade clicks, which produced 1 customer and 1 session;
  - forged and unsigned webhooks, which were rejected;
  - signed real events, including replaying the same event;
  - an unrelated product and wrong-tenant metadata, neither of which granted Pro;
  - a customer not linked in our database, which was ignored;
  - renewal using a Stripe test clock;
  - cancellation at period end and immediately;
  - reconciliation repairing drift, then changing nothing on a second run.

  Locally, webhook events were signed with a local secret rather than
  delivered by `stripe listen`.
- **Not covered:**
  - Reconciliation only covers workspaces that have a Stripe customer. A
    plan set by hand (the seeded Northwind "Pro") is not downgraded by it.
  - Two `syncCustomer` calls racing in the same instant can finish in
    either order. Both read live Stripe state, and the next event or
    reconcile run corrects a stale write.

## 4. AI assistant

**Provenance**
- Clients may insert only `(thread_id, content)` into their own thread, as
  role `user`.
- Assistant replies, the tool list and token counts are written only by
  `record_assistant_message()`, which only `service_role` can execute. The
  server calls it after checking the session.

**Prompt injection and exfiltration**
- Tool results are wrapped as `untrusted_data`: control characters are
  stripped, strings are truncated, and the result is size-capped.
- Lead notes and personal emails are not sent to the model.
- Workspace and user names are quoted as data in the system prompt.
- The renderer drops raw HTML, renders images as their alt text only, and
  makes links clickable only for same-origin paths.
- The CSP (`img-src`, `connect-src` and `font-src` are `'self'`) means that
  even injected markup can't make the browser fetch an external URL.

**Budgets (database)**
- 6 questions per user per minute.
- 1 generation per conversation at a time.
- 2 concurrent generations per user.
- The monthly plan quota.
- An owner can turn AI off for the workspace (`tenants.ai_enabled`).

**Budgets (application)**
- At most 4 model steps and 6 tool calls.
- 1,024 output tokens.
- A bounded history.
- 8-second tool timeouts and a 60-second request deadline.
- When the browser disconnects, the Gemini call is aborted. Verified live:
  aborted after about 1.3s, the reply was recorded as cancelled, and the
  lease was released.

**Read-only tools run with the user's own session**
- RLS limits them to the user's own workspace and role.
- List tools are capped at 25–50 rows.

### What data goes to Gemini

When AI is on for a workspace, each question is sent to Google Gemini
together with:
- the workspace name and the user's name and role;
- recent conversation history;
- the results of any tools the model calls. These can include team member
  names and roles, lead names, companies, budget, size, source, status,
  score and owner, appointment titles, times, statuses and lead names, plan
  and seat usage, and pending-invitation roles.

Lead notes and email addresses are not included.

- **Operators** must review Google's data-use and retention terms for their
  API tier (for example, whether prompts may be used to improve models on
  the free tier) before putting real customer data through it.
- **Workspaces** that don't want this processing should switch AI off under
  *Settings → Workspace*.
- **Regulated data** (health, financial and similar) needs a data
  processing agreement with the provider, a review of residency and
  retention, and probably more redaction. This project makes **no**
  HIPAA, GDPR or SOC 2 compliance claim.

## 5. Public booking

The database is the final authority. Each check below refuses a booking
before it reaches the next.

1. **Input validation and per-IP rate limits** in the server action:
   - 5 booking attempts per IP per workspace every 10 minutes;
   - 20 booking attempts per IP per hour;
   - 60 availability page views per IP per minute.

   With no configuration, limits are counted in memory per server process,
   so nothing paid is required. Set `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` to share counters across instances. If that
   store is down, limiting falls back to in-process counting.
2. **Optional Cloudflare Turnstile.**
   - Set **both** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
     `TURNSTILE_SECRET_KEY`.
   - The secret stays on the server and the token is verified there.
   - A missing or failed check never calls the booking RPC.
   - If only one key is set, bookings are refused (fail closed).
   - With neither set, the demo works without it.
3. **Database checks (`book_appointment`)**:
   - validated lengths and email;
   - at most 3 upcoming bookings per normalised email;
   - at most 50 booking-page bookings per workspace per 24 hours;
   - a per-(workspace, email) advisory lock;
   - an exclusion constraint that makes double booking impossible.

   Completed appointments keep their slot, and status transitions are
   enforced by a trigger.

**Limitation:** the IP is taken from the last `x-forwarded-for` hop. That
is correct behind Vercel or an appending proxy such as nginx. On a server
exposed directly to the internet with no proxy, a client can spoof it, and
the database caps are what remain.

## 6. Links that carry secrets

Invitation links (`/invite/<token>`) and booking-management links
(`/book/manage/<token>`) are bearer tokens:
- Invitation tokens have 244 bits of randomness and booking tokens 256 bits.
- Their pages send `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- The CSP blocks any third-party resource that could see the URL.
- The app logs no URLs or tokens.

Tokens are stored as plain text, not hashed, and this is a deliberate
tradeoff for this build:
- with this much entropy, guessing is infeasible;
- clients can't read them (booking tokens have no column grant, and
  invitation tokens are visible only to owners and admins, who need to copy
  invite links);
- hashing would mean invite links could no longer be shown again after
  creation.

A production deployment worried about a database read leak could hash them
(store `sha256(token)`, show the link once) as a follow-up migration.

## 7. Redirects, links and headers

- Every generated link (auth emails, invites, booking, Stripe return URLs)
  uses `NEXT_PUBLIC_SITE_URL`. It is required in production and must be
  https; request `Host` and `Origin` headers are not trusted for this.
- `next` parameters go through `safeRelativePath()`. It rejects:
  - `//host`;
  - backslashes, whether raw or `%5C`;
  - encoded slashes;
  - control characters;
  - other origins.

  Unit tests and a fuzz list cover it.
- Headers:
  - A per-request nonce CSP is set in `src/proxy.ts`, and every page
    renders dynamically so it can carry the nonce.
  - `script-src 'nonce-…' 'strict-dynamic'`, with no `unsafe-inline`
    scripts.
  - `img-src`, `connect-src` and `font-src` are `'self'`.
  - `frame-ancestors 'none'` and `object-src 'none'`.
  - `form-action` allows `'self'` plus Stripe Checkout and the Billing
    Portal.
  - `X-Frame-Options: DENY`, `nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
    `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and
    HSTS in production (`next.config.ts`).
  - `style-src` allows `'unsafe-inline'` because React `style` attributes
    can't carry a nonce. CSS still can't load anything external.

## 8. Authentication: demo vs production

`supabase/config.toml` configures only the **local** Supabase stack (the CLI
and CI). It does not change a hosted project. Hosted Auth settings are
changed in the Supabase dashboard (or with `supabase config push`, which
should be reviewed with a diff first).

| Setting | This demo (hosted) | Production |
|---|---|---|
| Minimum password length | UI and server action require 8 (the hosted Auth setting must also be raised to 8, or the Auth API accepts shorter) | 8+ in Supabase Auth, ideally with a character requirement |
| Email confirmation | Off (Supabase's built-in mailer only reaches the project team) | On, with your own SMTP |
| Secure password change | Local config: on | On |
| Auth rate limits | Supabase defaults | Review sign-in/sign-up/OTP limits |
| Redirect allowlist | `http://localhost:3000` | Only your https domain(s) |
| CAPTCHA on sign-up | Off | Optional: Turnstile or hCaptcha in Supabase Auth |

## 9. Secrets and operations

- Secrets live only in the gitignored `.env.local` and the host's
  environment. Nothing secret is prefixed `NEXT_PUBLIC_`.
- The Supabase secret key is used server-side only, for webhook and billing
  sync, the single assistant-reply write, and the seed.
- `npm run seed` deletes and recreates the `*.example` demo accounts. It
  refuses to run unless `ALLOW_DESTRUCTIVE_DEMO_SEED=true`, and never with
  `NODE_ENV=production`. Passwords go only to the gitignored
  `.demo-credentials.local.md`.
- CI (`.github/workflows/ci.yml`) uses **no repository secrets**:
  - unit tests, typecheck, lint and a build with dummy public values;
  - pgTAP against a throwaway local Supabase stack in Docker;
  - `npm audit`;
  - dependency review on pull requests.

  Dependabot keeps npm packages and Actions up to date. To make these checks
  required, enable branch protection on `main` (Settings → Branches) and
  require the CI jobs.
