# Upgrading an existing database to multi-tenant

This version adds an `Organization` model as the tenant root, and every business table
(`products`, `customers`, `sales_orders`, etc.) now has a required `organization_id` column.
Sandbox environments couldn't reach `binaries.prisma.sh` to generate a migration file for you,
so **you need to generate and review it yourself** with real network access. Do this in order:

## 1. Back up your database first

```bash
pg_dump "$DATABASE_URL" > backup-before-multitenant.sql
```

## 2. Generate the migration

```bash
npx prisma migrate dev --name add_multi_tenancy --create-only
```

This will fail to apply automatically because `organization_id` is `NOT NULL` on tables that may
already have rows. Open the generated SQL file in `prisma/migrations/<timestamp>_add_multi_tenancy/`
and add a data-backfill step **before** the `ALTER TABLE ... ADD COLUMN organization_id ... NOT NULL`
lines, e.g.:

```sql
-- 1. Create one organization for all existing data
INSERT INTO organizations (name, slug, created_at, updated_at)
VALUES ('My Company', 'my-company', now(), now());

-- 2. Add organization_id as nullable first
ALTER TABLE users ADD COLUMN organization_id INTEGER;
-- ...repeat for every table the migration adds organization_id to...

-- 3. Backfill every row to that one organization
UPDATE users SET organization_id = (SELECT id FROM organizations LIMIT 1);
-- ...repeat for every table...

-- 4. THEN make it NOT NULL and add the FK/index (Prisma's generated SQL already does this part)
ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL;
```

Also double check the new `@@unique([organizationId, sku])` (and similar) constraints don't
conflict with existing data — since everything is backfilled into a single organization, any
duplicate SKUs/emails/order numbers that existed before will now violate the new per-org unique
constraint and need to be resolved manually first.

## 3. Apply it

```bash
npx prisma migrate deploy
```

## 4. Rotate secrets

Every existing user's session is invalidated by this upgrade anyway (the auth mechanism changed
from Bearer token to httpOnly cookie), so this is a good moment to also rotate `JWT_SECRET`.

## 5. Everyone re-logs in

There is no way to migrate an old `localStorage` token into the new cookie-based session — every
user will simply see a 401 on their next request and be redirected to `/login`, which is expected.
