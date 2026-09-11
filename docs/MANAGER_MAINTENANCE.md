# Manager Maintenance

**Status:** implemented · migration `0016_manager_maintenance` · decision **D-095**
**Repos:** `CMBBACKEND` (`src/modules/maintenance.routes.ts`) · `CMBFRONTEND` (`src/app/(app)/maintenance/*`)

---

## 1. What this is, and what it is not

Management tracks this business in four spreadsheets: a **Field Verification Report checklist**, a
**Transfer / Disbursement** register, an **APTS** register and a **Payment** register. This feature
makes the CRM produce those four formats — the same headings, the same wording, the same column
order — **from the records that were already the source of truth**.

**It is not** four new databases. There is no `fvr_tracking`, `transfer_tracking`, `apts_tracking`
or `payment_tracking` table and there must never be one. The four sheets are **read projections**
over `customers`, `loans`, `verifications` and `disbursements`, plus a small number of genuinely
new annotation columns.

A disbursement's amount appears on three of the four sheets and is read from `disbursements.amount`
every time. A second, editable copy would be two numbers that can disagree about how much money
moved.

---

## 2. Authoritative vs derived vs maintenance data

Every value on every sheet is one of three things. This distinction governs what may be edited and
where.

| Class | Meaning | Editable from the maintenance screens? |
|---|---|---|
| **Authoritative** | The CRM already owns it (`customers.name`, `disbursements.amount`, `disbursements.utr`) | **No.** Edited where it lives, through its own route and permission. |
| **Derived** | Computed from authoritative data at read time (`Sl No`, `Loan Disbursed YES/NO`, `Fund Credited to Customer`) | **No.** There is nothing to edit; changing the source changes the sheet. |
| **Maintenance** | The manager's own annotation, which the CRM had nowhere to put (`Payment Status`, `BT Lead ID`, the FVR findings) | **Yes**, via `PATCH /api/maintenance/*` under `maintenance.edit`. |

---

## 3. The four formats

Heading text and heading order are transcribed from the supplied screenshots and are pinned by
`CMBFRONTEND/src/lib/maintenance/maintenance-formats.test.ts`, which transcribes them
*independently* so the test cannot drift with the code.

Per-sheet inconsistencies in management's own wording are **preserved deliberately**:

- the Transfer and Payment sheets spell the serial column `SI.NO`; FVR and APTS spell it `Sl No`;
- APTS heads its last column `Fund Credited Customer`, Payment heads the same value
  `Fund Credited to Customer`;
- APTS orders `Transfer Amount` before `Branch Name`; Payment reverses them.

### 3.1 FVR — `/maintenance/fvr`

A **vertical per-customer form**, not a list: `Sl No` · `Particulars` · `Details`, under the
`Sharvika Financial Services Pvt Ltd` letterhead, with a `Date:` line.

| # | Particular | Source | Class |
|---|---|---|---|
| 1 | `Customer Name` | `customers.name` | authoritative |
| 2 | `Loan Amount` | `loans.amount_approved` when > 0, else `loans.amount_requested` | authoritative |
| 3 | `Takeover From (Existing Lender Name)` | `verifications.takeover_from_lender` | **new** |
| 4 | `FVR Done By (Name & Designation)` | `verifications.fvr_done_by_name` + `.fvr_done_by_designation` | **new** |
| 5 | `Customer Profile (Occupation / Business / Employment)` | `customers.occupation` | authoritative |
| 6 | `House Confirmation (Owned / Rented)` | `verifications.house_confirmation` | **new** |
| 7 | `Annual Income` | `verifications.annual_income` | **new** |
| 8 | `Any Existing Relationship with Chola (Yes / No)` + `If yes, specify details outstanding loan amount` | `verifications.chola_relationship` + `.chola_outstanding_details` | **new** |
| 9 | `New KYC /Customer (Yes / No)` | `verifications.new_kyc_customer` | **new** |
| 10 | `Remarks (if Any)` | `verifications.notes` — **existing column, display rename only** | authoritative |
| 11 | `Zensify RM Signature` | `verifications.zensify_rm_signature` | **new** |
| 12 | `Sharvika RM Signature` | `verifications.sharvika_rm_signature` | **new** |
| 13 | `Chola RM/BM/ARBM Sign` | `verifications.chola_sign` | **new** |
| — | the form's `Date:` line | `verifications.fvr_date` | **new** |

An FVR exists for a loan **once that loan has a verification record**. This exposes the CRM's
existing field-verification domain — which had no UI at all — rather than creating a second one.

**`Annual Income` is not derived from `customers.monthly_income × 12.`** A verification records an
observed figure; multiplying a declared monthly income would print a number nobody verified onto a
verification document.

### 3.2 Transfer / Disbursement — `/maintenance/transfer`

Thirteen columns, one row per disbursement.

| Heading | Source | Class |
|---|---|---|
| `SI.NO` | ordinal over the returned ordering — **no database sequence** | derived |
| `DATE` | `coalesce(disbursements.disbursed_on, disbursements.created_at)` | authoritative |
| `CUSTOMER NAME` | `customers.name` | authoritative |
| `MOBILE NUMBER` | `customers.mobile` | authoritative |
| `REGION NAME` | `loans.branch_id → branches → areas → regions.name` | authoritative (new master data) |
| `AREA NAME` | `… → areas.name` | authoritative (new master data) |
| `BRANCH` | `… → branches.name` | authoritative (new master data) |
| `BT LEAD ID` | `loans.bt_lead_id` | **new**, maintenance |
| `MANAGER NAME` | `users.name` via `coalesce(disbursements.assigned_user_id, loans.assigned_user_id)` | authoritative |
| `Loan Disbursed YES/NO` | `loans.status = 'Disbursed'` | derived |
| `TRANSFER AMOUNT` | `disbursements.amount` | authoritative |
| `UTR NUMBER` | `disbursements.utr` | authoritative |
| `REMARK` | `disbursements.notes` | authoritative |

### 3.3 APTS — `/maintenance/apts`

Six columns over the same projection, ending in a **totals band** on `Transfer Amount`.

`Sl No` · `Date` · `Customer Name` · `Transfer Amount` · `Branch Name` · `Fund Credited Customer`

Dates render `01-Aug-26`; the credit column renders `01-08-2026 (10:50 AM)`.

> **What "APTS" stands for is not established anywhere in this repository or in the material
> supplied.** Nothing here interprets it: no APTS-specific workflow, status, table or business rule
> was invented. It is management's own name for this view and is used as a label only.

### 3.4 Payment — `/maintenance/payment`

APTS plus `Payment Status`, with `Branch Name` and `Transfer Amount` transposed. Also ends in a
totals band. The credit column renders a **time only** (`1:01 PM`) because the date is its own column.

---

## 4. The four resolutions that mattered

### 4.1 `Fund Credited to Customer` = the credit timestamp

The supplied sheets settle what this column means: APTS shows `01-08-2026 (10:50 AM)` and Payment
shows `1:01 PM`. It is **a timestamp**, not a Yes/No and not a beneficiary account.

Source: **`disbursements.approved_at`, but only when `status = 'Credited'`.**

That is the honest source, and it is provable:

- `initialStatuses: ["In Transit"]` — a disbursement can never be *created* `Credited`;
- `patchRefusals.status` — PATCH can never set it;
- therefore `Credited` is reachable **only** through `POST /api/disbursements/:id/approve`;
- that route stamps `approvedAt: new Date()` inside the approving transaction.

**The `status = 'Credited'` guard is load-bearing.** `approved_at` is stamped on the `→ Failed`
transition too, so an unguarded column would print a credit time for money that bounced. A
non-credited row reports **blank**.

### 4.2 `Payment Status` is maintenance data, not financial state

In the supplied Payment sheet, **every row carries a credit time and every row reads `Not Received`.**
The money reached the customer and the status still says not received — so this cannot be
`disbursements.status`, `transactions.status` or `settlements.status`.

It is a downstream receipt flag the manager maintains by hand. Stored as
`disbursements.payment_status`, nullable, CHECK-constrained. Separation from the money path is
**structural**, not a convention:

- absent from `disbursementsRouter.createSchema`, so POST cannot set it;
- `patchSchema` derives from that schema, so PATCH cannot either;
- `transitionColumn` is `status`, so no transition machinery ever reads it;
- no guard, hook, notification, ledger entry or approval reads it;
- the only writer is `PATCH /api/maintenance/payment/:id` under `maintenance.edit`.

Setting it to `Received` moves no money and approves nothing.

**Vocabulary:** `Received` / `Not Received`. Only `Not Received` is attested in the supplied sheet;
the binary is the minimal honest reading. ⚠️ **Confirm with management.** If the real vocabulary is
longer, the change is one const (`paymentStatuses`) and one CHECK.

### 4.3 `Loan Disbursed YES/NO` comes from the loan, not the disbursement

The manager's own sample row reads `YES` with a **blank UTR**. In this CRM a loan becomes
`Disbursed` the moment a disbursement is recorded, while the UTR arrives later — which reproduces
that row exactly. `disbursements.status = 'Credited'` would have printed `NO` for it.

Blank when the loan status is unknown: `NO` is an assertion, and an absent record is not one.

### 4.4 `BT Lead ID` is externally issued and is never generated

Sample: `BTOMKA250626053704`. Issued outside this system, so `loans.bt_lead_id` is free text,
nullable, and **never synthesised** — a generated external reference is one no other system
recognises. Deliberately not unique: there is no format rule for it, and a uniqueness constraint on
an identifier we do not mint would reject legitimate data on someone else's typo.

> **What "BT" stands for is not established in this repository.** Nothing infers it.

---

## 5. Region ▸ Area ▸ Branch

Three new master tables. The manager's sheet proves the hierarchy: `AREA NAME = HYDERABAD` with
`BRANCH = OMKAR NAGAR`, and the APTS sheet lists Uppal, LB NAGAR and Kompally under the same area.

```
regions ──< areas ──< branches
                          ^
                          └── loans.branch_id (nullable)
```

- A **branch names its area once**; an **area names its region once**. Region and Area are *not*
  denormalised onto `loans`, so a branch cannot disagree with itself about which area it is in.
- `branches.bank_id` is **nullable** — the sheets name branches without always naming the lender.
  It is therefore **never fed to `bankScope`**, which filters with `inArray` and never matches NULL
  (the D-084 defect). Tenant isolation is enforced on the operational rows instead, whose `bank_id`
  is NOT NULL.
- Master data is **deactivated, never deleted** (`status: Active | Inactive`), so a historical file
  keeps resolving the branch it was booked at. These tables are deliberately absent from
  `softDeletableTables` — nothing offers a delete and nothing reaches the recycle bin.

### What was NOT touched

`customers.branch` and `users.branch` are **unchanged and still work exactly as before.**
They are different things — `customers.branch` sits beside `account_no`/`ifsc` and is the
customer's own bank-account branch; `users.branch` is an employee's posting. Both are free text.
The new `branch_id` coexists with them and replaces neither.

---

## 6. Permissions

| Key | Held by | Grants |
|---|---|---|
| `maintenance.view` | Super Admin, Admin, Manager | Read all four sheets and the location lists |
| `maintenance.edit` | Super Admin, Admin, Manager | Write the maintenance fields |
| `maintenance.manage_locations` | Super Admin, Admin | Create regions, areas and branches |

Team Leader and Executive hold none: these are a manager's sheets.

`manage_locations` is withheld from Manager deliberately — renaming a branch re-labels every
historical sheet that resolves through it, which is an administrative act.

> ⚠️ **Existing deployments:** `seed()` tops up non-system roles only on first creation, so an
> **existing** Admin or Manager role row will NOT receive these keys automatically. Only
> `super_admin` (which holds `*`) gets them for free. Grant them on the Roles screen after deploy.

---

## 7. Security

Identical posture to every other read in the codebase; nothing novel was introduced.

- `requireAuth` on the router — nothing is reachable anonymously (401).
- `requirePermission` per route — a non-holder gets **403, never 404 or 422**, because the gate runs
  before the row is looked up. Pinned for all five roles by `role-matrix.test.ts`.
- `bankScope(ctx, <driving table>.bank_id)` in the SQL WHERE clause of every projection, always on a
  NOT NULL column (`verifications.bank_id`, `disbursements.bank_id`).
- A client `bankId` filter passes through `assertBankAccess` **first** — it can narrow the scope and
  can never widen it (403 if it tries).
- Every mutation re-reads the target row and re-asserts bank access **on the row's own `bank_id`**,
  not on anything the caller sent.
- Every mutation writes an audit row in the same transaction.
- Explicit column projections everywhere — never a bare `.select()` over a join, which would return
  `customers.aadhaar_hash` (SEC-007).

---

## 8. Export

One definition drives the screen and the file. `CMBFRONTEND/src/lib/maintenance/formats.ts` owns
every heading, every order and every cell's text; the table renderer and the CSV builder both read
those same objects, so they cannot drift.

- Exports fetch the **complete filtered set** (`pageSize=0`), never the page on screen. The server
  refuses past `MAINTENANCE_EXPORT_MAX` (20,000) rather than truncating.
- CSV formula-injection neutralisation is inherited unchanged from `lib/export.ts`.
- An empty sheet exports its **heading line**, not a zero-byte file.
- APTS and Payment append the totals band. A sheet with no figures gets **no** totals row — `0.00`
  would assert that the rows add up to nothing.
- FVR exports **vertically**: `Sl No,Particulars,Details`, thirteen rows, serials `1..13`.
  The source form numbers its last three rows `11, 11, 12`; that typo is **not** reproduced.
- The FVR screen also offers a print view. It uses `toast.info`, never `toast.success` — a print
  dialog produces no file and the user may cancel it.

`DataTable` is **not** used for these sheets and is unmodified. Its CSV keys records by heading (two
equal headings would collapse), it exports only the rows it holds, and it cannot emit a totals row.

---

## 9. What is intentionally blank

The manager's own sheets have blank cells, and so does this. **Nothing is defaulted, inferred or
fabricated.** In the current data these columns will be empty until the CRM starts capturing them:

| Column | Why it is blank today |
|---|---|
| `MANAGER NAME` | `loans.assigned_user_id` and `disbursements.assigned_user_id` are never written by the shipped UI, so files have no owner recorded. |
| `REMARK` | `disbursements.notes` has no UI writer. |
| `Customer Profile` | `customers.occupation` is settable only via the Excel importer and the API — it is on no customer form. |
| `REGION / AREA / BRANCH` | Blank until master data is created and files are assigned a branch. |
| `BT LEAD ID` | Blank until recorded. Never generated. |
| `Payment Status` | Blank until a manager records it. Never defaulted to either value. |
| `Fund Credited …` | Blank unless the disbursement is `Credited`. |
| The eleven FVR findings | Blank until a verifier records them. |

These are honest gaps in data capture, not defects in this feature. Closing them means writing the
values through the routes that own them.

---

## 10. Open questions for management

Recorded rather than guessed, per D-043.

1. **What does APTS stand for**, and how does the APTS sheet differ in purpose from the Payment
   sheet, whose columns are a superset of it?
2. **What does BT stand for in `BT LEAD ID`**, and who issues the identifier?
3. **`Payment Status` vocabulary** — is it the binary `Received` / `Not Received`, or longer?
4. **Is `Branch` on the Transfer sheet the same thing as `Branch Name` on APTS and Payment?**
   Implemented as one concept; trivially separable if not.
5. **`Fund Credited Customer` vs `Fund Credited to Customer`** — the two sheets head the same value
   differently. Both spellings are reproduced as supplied. Confirm whether one is a typo.
6. **The three signature lines** — are they a name typed by an authorised user, a scan, or a wet
   signature on a printed form that the CRM only records as obtained? Implemented as the last
   reading: free text that authorises nothing.
7. **`Annual Income`** — independently observed, or `monthly_income × 12`? Implemented as observed.
8. **`Loan Amount` on the FVR** — requested, sanctioned, or transferred? Implemented as
   sanctioned-if-recorded-else-requested, following the existing reports convention.
