/**
 * PERMISSION CATALOGUE
 *
 * This is the only place permission strings are declared. Routes reference
 * `PERMISSIONS.customers.create` — never a role name. Adding a role never
 * requires a code change; adding a *capability* does, which is correct.
 */

const define = <T extends Record<string, Record<string, string>>>(catalogue: T): T => catalogue;

export const PERMISSIONS = define({
  customers: {
    view: "customers.view",
    create: "customers.create",
    edit: "customers.edit",
    delete: "customers.delete",
    import: "customers.import",
    export: "customers.export",
  },
  banks: {
    view: "banks.view",
    create: "banks.create",
    edit: "banks.edit",
    delete: "banks.delete",
    assign: "banks.assign",
  },
  users: {
    view: "users.view",
    create: "users.create",
    edit: "users.edit",
    delete: "users.delete",
    assign: "users.assign",
    resetPassword: "users.reset_password",
  },
  roles: {
    view: "roles.view",
    create: "roles.create",
    edit: "roles.edit",
    delete: "roles.delete",
    assignPermissions: "roles.assign_permissions",
  },
  teams: {
    view: "teams.view",
    create: "teams.create",
    edit: "teams.edit",
    delete: "teams.delete",
    assign: "teams.assign",
  },
  requests: {
    view: "requests.view",
    create: "requests.create",
    edit: "requests.edit",
    delete: "requests.delete",
    assign: "requests.assign",
    approve: "requests.approve",
    import: "requests.import",
  },
  verification: {
    view: "verification.view",
    create: "verification.create",
    edit: "verification.edit",
    approve: "verification.approve",
  },
  bankOrders: {
    view: "bank_orders.view",
    create: "bank_orders.create",
    edit: "bank_orders.edit",
    delete: "bank_orders.delete",
  },
  fundingSources: {
    view: "funding_sources.view",
    create: "funding_sources.create",
    edit: "funding_sources.edit",
    delete: "funding_sources.delete",
  },
  serviceProviders: {
    view: "service_providers.view",
    create: "service_providers.create",
    edit: "service_providers.edit",
    delete: "service_providers.delete",
  },
  disbursements: {
    view: "disbursements.view",
    create: "disbursements.create",
    edit: "disbursements.edit",
    approve: "disbursements.approve",
  },
  settlements: {
    view: "settlements.view",
    create: "settlements.create",
    edit: "settlements.edit",
    approve: "settlements.approve",
  },
  transactions: {
    view: "transactions.view",
    create: "transactions.create",
    edit: "transactions.edit",
  },
  ledger: {
    view: "ledger.view",
    create: "ledger.create",
    edit: "ledger.edit",
  },
  documents: {
    view: "documents.view",
    upload: "documents.upload",
    /*
     * Task 9.7, DECISIONS.md D-074.
     *
     * `documentsRouter.permissions.edit` used to map to `documents.upload`, and
     * `PATCH /api/documents/:id` is the route that verifies a KYC document — so
     * anyone who could upload could also verify their own upload.
     *
     * Granted to **Super Admin and Admin only**. Because those roles are
     * disjoint from the ones that upload (Team Leader and Executive hold
     * `documents.upload`), `verified_by != uploaded_by` holds by construction
     * for the seeded role set — four-eyes achieved structurally rather than by
     * a runtime guard that a single-operator DSA could never satisfy. D-057
     * deferred the runtime guard for loans on exactly that reasoning.
     *
     * Manager must be enumerated explicitly below rather than flattened, or it
     * silently inherits this.
     */
    verify: "documents.verify",
    delete: "documents.delete",
  },
  reports: {
    view: "reports.view",
  },
  /**
   * MANAGER MAINTENANCE — Task MM-1, D-095.
   *
   * The four tracking formats management already works in (FVR, Transfer /
   * Disbursement, APTS, Payment). Separate keys from `reports.view` on purpose:
   * these screens are the operational sheets a manager MAINTAINS, and `edit`
   * writes annotation columns that `reports.view` holders must not get by
   * implication.
   *
   * `edit` never reaches a financial field. The routes it gates write exactly
   * three things — the FVR checklist findings, a loan's branch and BT lead id,
   * and a disbursement's manager receipt flag — and not one of them is read by
   * any state machine, approval or money path.
   *
   * `manageLocations` is master data (Region ▸ Area ▸ Branch) and is Admin and
   * above: a renamed branch re-labels every historical sheet that resolved
   * through it, which is an administrative act, not an operational one.
   */
  maintenance: {
    view: "maintenance.view",
    edit: "maintenance.edit",
    manageLocations: "maintenance.manage_locations",
  },
  auditLogs: {
    view: "audit_logs.view",
  },
  recycleBin: {
    view: "recycle_bin.view",
    restore: "recycle_bin.restore",
    permanentDelete: "recycle_bin.permanent_delete",
  },
  settings: {
    view: "settings.view",
    edit: "settings.edit",
  },
  system: {
    /**
     * The bank-scope escape hatch. Held by Super Admin by default. Because it
     * is a permission and not a role check, the client can grant a bespoke
     * "Group Auditor" role read-everything access without touching code.
     */
    accessAllBanks: "system.access_all_banks",
    /** Allows managing users whose role level is <= the actor's own. */
    manageAnyUser: "system.manage_any_user",
  },
} as const);

export type PermissionKey =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS][keyof (typeof PERMISSIONS)[keyof typeof PERMISSIONS]];

export interface PermissionSeed {
  key: string;
  resource: string;
  action: string;
  description: string;
}

const DESCRIPTIONS: Record<string, string> = {
  "system.access_all_banks": "Bypass bank scoping and see records for every bank",
  "system.manage_any_user": "Manage users at or above the actor's own role level",
  "recycle_bin.permanent_delete": "Irreversibly purge a record from the recycle bin",
  "roles.assign_permissions": "Grant or revoke permissions on a role",
};

export const ALL_PERMISSIONS: PermissionSeed[] = Object.values(PERMISSIONS).flatMap((group) =>
  Object.values(group).map((key) => {
    const [resource = key, action = "view"] = key.split(".");
    return {
      key,
      resource,
      action,
      description: DESCRIPTIONS[key] ?? `${action.replace(/_/g, " ")} ${resource.replace(/_/g, " ")}`,
    };
  }),
);

export const ALL_PERMISSION_KEYS: string[] = ALL_PERMISSIONS.map((p) => p.key);

const flat = (group: Record<string, string>): string[] => Object.values(group);

/**
 * DEFAULT ROLES
 *
 * Seed data, not law. Every one of these is editable after first boot except
 * `super_admin`, which is `isSystem` and always holds the full catalogue.
 *
 * `level`: lower == more authority. A user can only create, edit, delete or
 * assign a role to a user whose role level is strictly GREATER than their own,
 * unless they hold `system.manage_any_user`. That single rule is what stops an
 * Admin creating another Admin or touching a Super Admin, with no `if (role ===
 * "admin")` anywhere in the codebase.
 */
export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  permissions: string[] | "*";
}

export const DEFAULT_ROLES: RoleSeed[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Unrestricted access. Protected system role.",
    level: 0,
    isSystem: true,
    permissions: "*",
  },
  {
    key: "admin",
    name: "Admin",
    description: "Operational administration below Super Admin.",
    level: 10,
    isSystem: false,
    permissions: [
      ...flat(PERMISSIONS.customers),
      ...flat(PERMISSIONS.banks),
      ...flat(PERMISSIONS.teams),
      ...flat(PERMISSIONS.requests),
      ...flat(PERMISSIONS.verification),
      ...flat(PERMISSIONS.bankOrders),
      ...flat(PERMISSIONS.fundingSources),
      ...flat(PERMISSIONS.serviceProviders),
      ...flat(PERMISSIONS.disbursements),
      ...flat(PERMISSIONS.settlements),
      ...flat(PERMISSIONS.transactions),
      ...flat(PERMISSIONS.ledger),
      ...flat(PERMISSIONS.documents),
      ...flat(PERMISSIONS.reports),
      // Manager Maintenance, including the Region ▸ Area ▸ Branch master data —
      // D-095. Admin is "operational administration below Super Admin", which is
      // exactly what maintaining the branch list is.
      ...flat(PERMISSIONS.maintenance),
      PERMISSIONS.users.view,
      PERMISSIONS.users.create,
      PERMISSIONS.users.edit,
      PERMISSIONS.users.delete,
      PERMISSIONS.users.assign,
      PERMISSIONS.users.resetPassword,
      PERMISSIONS.roles.view,
      PERMISSIONS.auditLogs.view,
      PERMISSIONS.recycleBin.view,
      PERMISSIONS.recycleBin.restore,
      PERMISSIONS.settings.view,
      /*
       * U-14, resolved as OD-8 — `settings.edit` is Super Admin **and Admin**.
       *
       * Until Task 12.6 this key was held by Super Admin alone and consumed by
       * no route, so the question had never had to be answered. `PATCH
       * /api/settings` writes organisation-level configuration — the registered
       * company record and the recycle-bin retention window. That is operational
       * administration, which is precisely what the Admin role is described as
       * ("Operational administration below Super Admin"), and Admin already
       * holds `settings.view`, `banks.*`, `users.*` and `recycle_bin.restore` —
       * strictly more consequential capabilities than a retention window.
       *
       * It stops here. Manager, Team Leader and Executive get neither
       * `settings.view` nor `settings.edit`; a retention window that field staff
       * can shorten is a records-retention control with no control.
       */
      PERMISSIONS.settings.edit,
      PERMISSIONS.system.accessAllBanks,
    ],
  },
  {
    key: "manager",
    name: "Manager",
    description: "Runs one or more teams across assigned banks.",
    level: 20,
    isSystem: false,
    permissions: [
      ...flat(PERMISSIONS.customers),
      PERMISSIONS.banks.view,
      PERMISSIONS.users.view,
      PERMISSIONS.teams.view,
      PERMISSIONS.teams.assign,
      ...flat(PERMISSIONS.requests),
      ...flat(PERMISSIONS.verification),
      ...flat(PERMISSIONS.bankOrders),
      PERMISSIONS.disbursements.view,
      PERMISSIONS.disbursements.create,
      PERMISSIONS.disbursements.edit,
      PERMISSIONS.settlements.view,
      PERMISSIONS.transactions.view,
      PERMISSIONS.transactions.create,
      PERMISSIONS.ledger.view,
      /*
       * OD-7, Task 11.6(a) — segregation of duties for the book.
       *
       * `ledger.create` was held only by Super Admin and Admin, so THREE of the
       * five roles could not post a voucher at all: Manager was refused at
       * `requirePermission`, and Team Leader and Executive hold no ledger key
       * whatsoever. A DSA's day-to-day book cannot be a two-role feature.
       *
       * Granted to **Manager and above**. Team Leader and Executive stay
       * view-only — field staff do not post to the book, which keeps a
       * maker-checker separation between the people who originate a file and
       * the people who account for it.
       *
       * `ledger.edit` is deliberately NOT granted: financial records are
       * immutable in terminal states and corrections are compensating entries
       * (D-069).
       */
      PERMISSIONS.ledger.create,
      /*
       * Enumerated, not flattened — Task 9.7 / D-074. `flat(PERMISSIONS.documents)`
       * would hand Manager the new `documents.verify` key silently, and the
       * grant set is what makes four-eyes structural.
       */
      PERMISSIONS.documents.view,
      PERMISSIONS.documents.upload,
      PERMISSIONS.documents.delete,
      PERMISSIONS.reports.view,
      /*
       * These are the Manager's OWN tracking sheets — D-095. Enumerated rather
       * than flattened, deliberately and for the reason D-074 gives for
       * documents: `flat(PERMISSIONS.maintenance)` would hand Manager
       * `maintenance.manage_locations` silently, and renaming a branch re-labels
       * every historical sheet that resolves through it. Master data stays with
       * Admin; the Manager maintains files, not the branch list.
       */
      PERMISSIONS.maintenance.view,
      PERMISSIONS.maintenance.edit,
      PERMISSIONS.recycleBin.view,
      PERMISSIONS.recycleBin.restore,
    ],
  },
  {
    key: "team_leader",
    name: "Team Leader",
    description: "Leads a team of executives within assigned banks.",
    level: 30,
    isSystem: false,
    permissions: [
      PERMISSIONS.customers.view,
      PERMISSIONS.customers.create,
      PERMISSIONS.customers.edit,
      PERMISSIONS.customers.import,
      PERMISSIONS.banks.view,
      PERMISSIONS.users.view,
      PERMISSIONS.teams.view,
      PERMISSIONS.requests.view,
      PERMISSIONS.requests.create,
      PERMISSIONS.requests.edit,
      PERMISSIONS.requests.assign,
      PERMISSIONS.verification.view,
      PERMISSIONS.verification.create,
      PERMISSIONS.bankOrders.view,
      PERMISSIONS.bankOrders.edit,
      PERMISSIONS.disbursements.view,
      PERMISSIONS.settlements.view,
      PERMISSIONS.transactions.view,
      PERMISSIONS.documents.view,
      PERMISSIONS.documents.upload,
      PERMISSIONS.reports.view,
    ],
  },
  {
    key: "executive",
    name: "Executive",
    description: "Field executive. Sees only their assigned banks.",
    level: 40,
    isSystem: false,
    permissions: [
      PERMISSIONS.customers.view,
      PERMISSIONS.customers.create,
      PERMISSIONS.customers.edit,
      PERMISSIONS.banks.view,
      PERMISSIONS.requests.view,
      PERMISSIONS.requests.create,
      PERMISSIONS.verification.view,
      PERMISSIONS.bankOrders.view,
      PERMISSIONS.disbursements.view,
      PERMISSIONS.transactions.view,
      PERMISSIONS.documents.view,
      PERMISSIONS.documents.upload,
    ],
  },
];

export const SUPER_ADMIN_ROLE_KEY = "super_admin";
