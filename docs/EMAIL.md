# EMAIL — PRODUCTION READINESS AUDIT

**Compiled 2026-09-06 (Wave 5) from source, not from memory.** Every claim below
carries the file it was read from. Where the code and an earlier document
disagreed, the code won.

> ## STATUS: **CODE COMPLETE · NEVER EXERCISED AGAINST RESEND**
>
> Every flow is implemented, wired and tested against a fake transport. **No
> message has ever been sent to a real provider from this repository** — there
> is no API key here and no network. §4 is the procedure that closes that gap,
> and it is a human step.

---

## 1. CONFIGURATION

All four variables are **optional in development and test** and **required in
production**. The split is enforced in `src/config/env.ts` — the schema
marks them optional, and the `NODE_ENV === "production"` block refuses to boot
without all four, naming the missing **keys** and never their values.

| Variable | Purpose | Required | Safe example | Consumed by |
|---|---|---|---|---|
| `EMAIL_PROVIDER` | Which transport to build. **Allowlist of one** — `resend`. A typo is a boot failure rather than a silent no-op | Production | `resend` | `config/env.ts` → `emailTransport()`; `services/email.ts` |
| `EMAIL_API_KEY` | Resend API key, begins `re_` | Production | *(ships empty — never a placeholder)* | `services/email.ts` → `sendViaResend()` |
| `EMAIL_FROM` | The From address | Production | `Rise Next <no-reply@risenext.in>` | `services/email.ts` |
| `EMAIL_REPLY_TO` | Where replies land | Production | `support@risenext.in` | `services/email.ts` |
| `FRONTEND_URL` | **The origin every emailed link is built from** | Production | `https://crm.risenext.in` | `services/invitations.ts` → `invitationUrl()`; `services/password-reset.ts` → `passwordResetUrl()` |

### `EMAIL_FROM` is deliberately not validated as a bare address

`config/env.ts` uses a custom regex, not `z.email()`, so that
`Display Name <user@example.com>` is accepted. That form is what production
actually uses, and rejecting it would be a false positive that stops a correct
deployment from booting.

### `FRONTEND_URL` is the one that fails silently

It is the only variable in the table whose absence produces **no error at all**.
Left at its `http://localhost:3000` default on a deployed backend, every
invitation and every reset email is sent successfully and every link in them is
useless. Nothing in the product can detect this — a well-formed URL is all it
checks, and the provider reports success because the message really was
delivered.

**Set it, and verify it by reading a real link (§4 step 3).**

### The transport, and what "no configuration" means

`config/env.ts`'s `emailTransport()` returns `"resend"` only when **all four**
keys are present; otherwise `"console"`. The console transport logs the
recipient, subject and full body — deliberately, since reading the link out of
the terminal is why it exists — and returns the outcome `logged`, which is
**counted as not delivered** everywhere it is surfaced (D-035).

Production cannot reach the console transport, because `loadEnv` refuses to boot
without the configuration.

---

## 2. THE FLOWS

There are **three** places mail is sent. Two templates exist and are sent by
nothing; both are listed so the gap is explicit rather than discovered later.

### 2.1 Employee invitation — on create

| | |
|---|---|
| **Trigger** | `POST /api/users` (Super Admin / Admin creating an employee) |
| **Entry point** | `modules/admin.routes.ts:363` → `sendEmail(employeeInvitationEmail({...}))` |
| **Token** | 48 random bytes, stored as SHA-256 only. `services/invitations.ts` → `issueInvitation()` |
| **Expiry** | **72 hours** (`INVITATION_TTL_HOURS`) — a Friday hire can act on Monday |
| **URL** | `${FRONTEND_URL}/accept-invite?token=…`, URL-encoded. `invitationUrl()`. No domain is hardcoded anywhere |
| **Redeemed at** | `POST /api/auth/accept-invite`; the page is `frontend/src/app/accept-invite/page.tsx` |
| **Success** | 201 with `invitation.status = "sent"`. The employee row exists either way |
| **Failure** | `"failed"` or `"logged"`. **Creation still succeeds** — issuance joins the create transaction, the send happens after commit |
| **User-visible** | The create screen shows the temporary password for hand-over **in every case**, and states whether a link is actually on its way. `logged` is grouped with `failed`, not with `sent` (Task 3.9) |

### 2.2 Resend invitation

| | |
|---|---|
| **Trigger** | `POST /api/users/:id/resend-invitation`, from the employee detail view |
| **Entry point** | `modules/admin.routes.ts:659` |
| **Authorization** | `users.reset_password` **and** `assertCanManageRoleLevel` — a flat permission check on a credential route is what BUG-038 was |
| **Guards** | 409 once accepted; 409 while the account is not Active (the link would be dead on arrival); 404 if soft-deleted |
| **Supersession** | The previous link is consumed first, so a reissue leaves exactly one live token |
| **Throttle** | **None.** Authenticated and hierarchy-bound, so SEC-005's public-endpoint limiter does not apply. The residual provider-quota risk is named in D-041 |

### 2.3 Password reset — self-service

| | |
|---|---|
| **Trigger** | `POST /api/auth/forgot-password`, from `/forgot-password` |
| **Entry point** | `services/password-reset.ts:113` → `sendEmail(passwordResetEmail({...}))` |
| **Expiry** | **1 hour** (`PASSWORD_RESET_TTL_HOURS`) — a reset link can seize an account and the requester is waiting on it |
| **URL** | `${FRONTEND_URL}/reset-password?token=…`. `passwordResetUrl()` |
| **Redeemed at** | `POST /api/auth/reset-password`; page `frontend/src/app/reset-password/page.tsx` |
| **Success** | **204, always.** Identical for a known address, an unknown one, a deleted one, a deactivated one, and a provider outage |
| **Failure** | Also 204. **This is the design** — anything else is an account-existence oracle. The failure is logged server-side, and the log line never names a missing address either |
| **On completion** | All sessions revoked, lockout cleared, no session created |
| **Rate limited** | Yes — the Task 3.6 limiter, plus 13.1's global limiter |

### 2.4 Written but never sent

`lib/email-templates.ts` exports **four** templates. Two have no caller:

| Template | Status |
|---|---|
| `employeeInvitationEmail` | ✅ sent (2.1, 2.2) |
| `passwordResetEmail` | ✅ sent (2.3) |
| `passwordChangedEmail` | ⚠️ **no caller.** `POST /api/auth/change-password` revokes every session and sends nothing |
| `accountDeactivatedEmail` | ⚠️ **no caller.** Deactivating an employee sends nothing |

Both are valid, tested, pure functions — infrastructure waiting for a decision,
not dead code. They are recorded here rather than deleted **or** silently wired:
sending a security notice is a product decision (who, when, and what it says
about an account somebody else deactivated), and inventing one is not this
document's job. **Nothing in the product claims either notice is sent.**

---

## 3. FAILURE HANDLING — the guarantees, and their limits

`services/email.ts`:

- **`sendEmail` never throws.** Not for a bad address, not for a dead provider,
  not from inside its own body — a throwing logger once escaped and turned
  employee creation into a 500, and the guarantee now covers the whole function.
  So `void sendEmail(...)` in a request path can neither fail the request nor
  leak an unhandled rejection.
- **Failure is reported, never swallowed.** The outcome is `sent` / `logged` /
  `failed`. `sent` means **accepted by the provider**, not delivered — nothing
  in this system can know about delivery, and no screen claims to.
- **Retries are bounded**: 3 attempts, 200/400 ms, on transport errors, 429 and
  5xx. A 4xx returns immediately, because a rejected address or a bad key is
  rejected identically forever.
- **The API key is scrubbed** from any reason that leaves the module. Both
  failure paths used to echo third-party text — a provider body, a transport
  error message — and the scrub is structural rather than trusting what Resend
  and undici put in their strings.

### What is not covered

- **No bounce or complaint handling.** Resend can webhook them; nothing receives
  it. A hard bounce is invisible to this system.
- **No suppression list.** A repeatedly bouncing address is retried forever by
  whoever clicks Resend.
- **No delivery tracking.** `users.invited_at` records **issuance**, not
  delivery, and is labelled that way on the Employees screen deliberately: the
  column would otherwise be null on every developer machine and still would not
  mean *received*.

---

## 4. PRODUCTION TEST PROCEDURE — human, external

**Nothing below has been executed.** Run it in order after configuring Resend.
Each step names what proves it worked.

### Prerequisites

- A Resend account with **your sending domain verified** (SPF + DKIM). An
  unverified domain sends, and lands in spam or is dropped.
- Railway variables set: `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM`
  (on the verified domain), `EMAIL_REPLY_TO`, and **`FRONTEND_URL` = the real
  Vercel origin**.
- An inbox you control that is **not** the bootstrap Super Admin's.

| # | Step | Does it work? |
|---|---|---|
| 1 | Sign in as the bootstrap Super Admin | You reach `/change-password` — the first login is forced (§`BOOTSTRAP.md`) |
| 2 | Employees → create an employee with your test inbox | 201. The screen shows a temporary password **and** says a setup link is on its way. If it says the link failed, stop — read `EMAIL_*` in Railway |
| 3 | Open the email | It arrives from `EMAIL_FROM`. **Hover the link before clicking**: the host must be your Vercel origin. `http://localhost:3000` means `FRONTEND_URL` is unset — the single most likely failure |
| 4 | Click the link | `/accept-invite` loads a password form, not a 404 and not "this invitation is not valid" |
| 5 | Set a password | 204, then a link to sign in. **No session is created** — this is correct |
| 6 | Sign in as the new employee | You reach the workspace. No forced password change: they chose it themselves |
| 7 | Sign out → "Forgot password?" → submit that address | A confirmation that does **not** name the address |
| 8 | Open the reset email | Arrives within a minute; the link host is again your Vercel origin |
| 9 | Follow it and set a new password | 204. Signing in with the **old** password now fails — every session was revoked |
| 10 | Paste the **same** reset link again | "not valid". Single-use is enforced by a conditional `UPDATE`, not by timing |
| 11 | Submit "Forgot password?" for `nobody@nowhere.invalid` | **Byte-identical** confirmation to step 7. Any difference is an account-existence oracle |
| 12 | Wait 1 h + 1 min, then use a fresh reset link | "not valid" |
| 13 | Resend an invitation to an employee who has **already accepted** | 409 with a clear message |
| 14 | Check the Resend dashboard | Every message above is listed as delivered. **This is the only place delivery can be confirmed** — the product only ever knows the provider accepted it |

**Only after step 14 may email be called production-ready**, and the claim
belongs to whoever ran it.

---

## 5. FAILURE MODES AND WHERE TO LOOK

| Symptom | Cause | Fix |
|---|---|---|
| Backend will not start, log names `EMAIL_*` | A production key is missing | Set all four in Railway |
| Employee created; screen says the link failed | Resend rejected it | Check the key, and that `EMAIL_FROM`'s domain is verified |
| Mail arrives; link goes to `localhost` | `FRONTEND_URL` unset or wrong | Set it, redeploy. **Previously issued links stay broken** — resend them |
| Link 404s | `FRONTEND_URL` points at the API, not the frontend | It is the **Vercel** origin |
| "This invitation is not valid" immediately | Expired (72 h), already consumed, or the account is not Active | Resend from the employee detail view |
| Reset always 204, nothing arrives | Working as designed for an unknown address; otherwise a provider fault | Check the Resend dashboard and the backend log — the failure is logged, never shown |
| Nothing at all, no error | `EMAIL_PROVIDER` blank → console transport | The log line says so at boot |

**Related:** `docs/SECRETS.md` (the variables) · `docs/BOOTSTRAP.md` (step 1) ·
`docs/RUNBOOK.md` (day-2 operations) · `docs/DECISIONS.md` D-033, D-035, D-037,
D-038, D-041.
