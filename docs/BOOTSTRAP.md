# FIRST SUPER ADMIN — THE BOOTSTRAP FLOW

**Audited 2026-09-06 (Wave 5) against `src/db/seed.ts`,
`src/config/env.ts`, `src/lib/password.ts`,
`src/middleware/auth.ts` and `src/modules/auth.routes.ts`.**
Every statement here was read out of the code.

> ## THE ONE THING THAT GOES WRONG
>
> **If either `BOOTSTRAP_SUPERADMIN_EMAIL` or `BOOTSTRAP_SUPERADMIN_PASSWORD` is
> unset, `db:seed` logs a warning and creates no user at all.** It exits **0**.
> The database then has roles and permissions and **zero accounts**, nobody can
> sign in, and nobody can create anyone — because creating a user requires a
> session. Read §5 before you run the seed.

---

## 1. WHAT THE SEED DOES, IN ORDER

`npm run db:seed` runs `seed()` in `src/db/seed.ts`:

1. **Upserts the permission catalogue** from `lib/permissions.ts`
   (`ALL_PERMISSIONS`), keyed on the stable `key`.
2. **Upserts the five default roles** — `super_admin`, `admin`, `manager`,
   `team_leader`, `executive` — and their grants.
   `name` is deliberately **not** overwritten: renaming a role is a supported
   client action and a redeploy must not undo it.
3. **Inserts the default required document types** (`onConflictDoNothing`).
4. **Creates the first Super Admin**, if and only if both bootstrap variables
   are set.

**It seeds no business data.** No banks, no customers, no loans, no
transactions. An empty database renders empty states rather than fabricated
records, so there is nothing to clean up afterwards.

**It is safe to re-run.** Everything is an upsert keyed on a stable identifier,
and step 4 leaves an existing account's password untouched.

---

## 2. THE VARIABLES

| Variable | Required | Secret | Notes |
|---|---|---|---|
| `BOOTSTRAP_SUPERADMIN_EMAIL` | For step 4 only | No | Lower-cased and trimmed before use |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | For step 4 only | **YES** | Must satisfy the policy below or the seed **throws** |

Both are `z.string().optional()` in the schema — the application never reads
them, only the seed does.

### The password policy, from `lib/password.ts`

`passwordProblems()`: **at least 12 characters**, and at least one lowercase
letter, one uppercase letter and one digit. No symbol requirement.

A password that fails throws `BOOTSTRAP_SUPERADMIN_PASSWORD <problems>` and the
seed exits **1**. That is the good failure: loud, immediate, nothing written.

---

## 3. WHAT GETS CREATED

From `bootstrapSuperAdmin()`:

| Column | Value |
|---|---|
| `employee_code` | `EMP-0001` |
| `name` | `Super Admin` |
| `email` | the variable, lower-cased and trimmed |
| `password_hash` | argon2id of the variable. **The plaintext is never stored** |
| `role_id` | the `super_admin` role |
| `branch` | `Head Office` |
| `status` | `Active` |
| `joined_on` | now |
| **`must_change_password`** | **`true`** |

### The forced change is real, and it is enforced server-side

`middleware/auth.ts` — `requireAuth` answers a flagged session with **403
`password_change_required`** on **every** authenticated route. Exactly two opt
out through `requireAuthAllowPasswordChange`:

- `GET /api/auth/me`
- `POST /api/auth/change-password`

So a bootstrap session can see who it is and replace its password, and nothing
else. It is not a nag screen: the API refuses (SEC-010 / D-023). The flag clears
in `auth.routes.ts` when the change succeeds, which also **revokes every refresh
token**, so the value that lives in the Railway dashboard stops being a
credential at that moment.

---

## 4. THE PROCEDURE

Run **after** migrations, and once only.

```bash
# On Railway, with the service's environment loaded:
railway run --service <backend> npm run db:seed
```

or, from a machine that can reach the database:

```bash
cd CMBBACKEND
DATABASE_URL='<direct connection string>' \
BOOTSTRAP_SUPERADMIN_EMAIL='ops@yourdomain.in' \
BOOTSTRAP_SUPERADMIN_PASSWORD='<generated, 12+ chars>' \
NODE_ENV=production \
npm run db:seed
```

**Expected output** — all three lines, or something is wrong:

```
Super admin created: ops@yourdomain.in (must change password on first login)
Seed complete
```

Then:

1. Sign in at the Vercel origin with those credentials.
2. You are redirected to `/change-password` and cannot leave it.
3. Set a real password. **You are signed out everywhere**, including here.
4. Sign in again with the new password.
5. **Delete `BOOTSTRAP_SUPERADMIN_PASSWORD` from Railway** and redeploy. It is
   inert after step 3 — the seed will not overwrite an existing account — but a
   dead credential in a dashboard is still a credential in a dashboard.
   `BOOTSTRAP_SUPERADMIN_EMAIL` may stay; it is not a secret.

### Then create everyone else, from the product

Employees → **New employee**, choosing a role. The hierarchy applies
immediately: an Admin cannot create another Admin or touch a Super Admin,
because `assertCanManageRoleLevel` is "strictly greater" and there is no
role-name comparison anywhere in the codebase.

Each new employee gets an emailed setup link (72 h) **and** an on-screen
temporary password, so onboarding survives a mail outage. See `docs/EMAIL.md`.

---

## 5. WHEN IT GOES WRONG

| Symptom | Cause | Recovery |
|---|---|---|
| Seed logs `BOOTSTRAP_SUPERADMIN_EMAIL / _PASSWORD not set — no super admin created`, exits 0 | One or both unset | Set both, re-run. Nothing was written, so this is safe |
| Seed throws `BOOTSTRAP_SUPERADMIN_PASSWORD must be at least 12 characters` | Policy | Choose a compliant password, re-run |
| Seed says `already exists — leaving the password untouched` | The account exists | **Not a way to reset the password.** §6 |
| `super_admin role missing — seed order is wrong` | Roles did not seed | The migrations did not apply. Run `npm run release` first |
| Sign-in fails with the bootstrap credentials | Typo, or the account was created against a different database | Confirm which `DATABASE_URL` the seed used. §6 |
| Sign-in succeeds, every page 403s | Working as designed — `password_change_required` | Complete the password change |

### The wrong email address

The account exists with an address you cannot receive mail at. There is **no
self-service path** — password reset needs the inbox.

Recover by creating a **second** bootstrap Super Admin: set the variables to a
new address, re-run the seed (it inserts because the email differs), sign in as
the new one, and delete or deactivate the first from Employees.

> ⚠️ `assertSuperAdminRemains` refuses any change that would leave **zero**
> active Super Admins, so the second must exist and be Active before the first
> is removed. Create, then delete — never the reverse.

---

## 6. EMERGENCY SUPER ADMIN RECOVERY

**There is no break-glass route and no recovery script.** This is deliberate —
one would be an unauthenticated path to full administrative access — and it is
recorded as a residual on SEC-003.

If **every** Super Admin is locked out, recovery is a direct database action
against the **direct** (non-pooled) endpoint, by someone holding the Neon
credential.

### Option A — the account exists and is deactivated or soft-deleted

Preferred: it changes state, not credentials.

```sql
-- Confirm first. Never guess which row.
select u.id, u.email, u.status, u.deleted_at, r.key
from users u join roles r on r.id = u.role_id
where r.is_system = true;

update users
   set status = 'Active', deleted_at = null, deleted_by = null
 where email = 'ops@yourdomain.in';
```

### Option B — the password is unknown

The application never stores plaintext, so nothing can be read out. Mint a new
hash **outside** the database and paste it in:

```bash
cd CMBBACKEND
node -e "import('argon2').then(async a=>console.log(await a.hash(process.argv[1],{type:a.argon2id})))" 'TemporaryPassword123'
```

```sql
update users
   set password_hash = '<paste the $argon2id$… string>',
       must_change_password = true,
       failed_login_attempts = 0,
       locked_until = null
 where email = 'ops@yourdomain.in';

-- End every existing session for that account.
update refresh_tokens set revoked_at = now()
 where user_id = (select id from users where email = 'ops@yourdomain.in');
```

Sign in, change the password immediately, and **write down that you did this** —
`audit_logs` records API activity, and a direct `UPDATE` appears in it nowhere.

> ⚠️ **Do not `DELETE FROM users`.** Nearly every business table references it,
> and the audit trail's `actor_id` is `on delete set null` — you would silently
> anonymise history. Deactivate instead.

### Option C — the role itself was disabled

`0001_governance_guards.sql` prevents a system role being deleted, re-keyed or
deactivated at the **database** level, so this should be unreachable. If it
somehow is, the guard fires on `UPDATE` too; investigate the trigger rather than
dropping it.

---

## 7. WHAT AN AUDITOR SHOULD BE ABLE TO SEE AFTERWARDS

- `audit_logs` contains a `login_succeeded` for the first sign-in and a
  `password_changed` immediately after. If the second is missing, the bootstrap
  credential may still be live.
- `users` contains exactly one `EMP-0001`, with `must_change_password = false`
  once step 3 is done.
- `BOOTSTRAP_SUPERADMIN_PASSWORD` is absent from the Railway environment.

**Related:** `docs/SECRETS.md` · `docs/DEPLOYMENT.md` · `docs/RUNBOOK.md` ·
`docs/EMAIL.md` · `docs/SECURITY_AUDIT.md` SEC-003, SEC-010.
