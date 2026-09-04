-- Multi-tenant transformation: Organization root + organizationId scoping.
-- Every app table below was empty at the time this migration was written,
-- so columns are added as NOT NULL directly (no backfill needed).

CREATE TABLE "organizations" (
    "id" SERIAL PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

CREATE TABLE "invites" (
    "id" SERIAL PRIMARY KEY,
    "organization_id" INTEGER NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" VARCHAR(100) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");
CREATE INDEX "invites_organization_id_idx" ON "invites"("organization_id");
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_name_key";
ALTER TABLE "categories" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "categories_organization_id_idx" ON "categories"("organization_id");
CREATE UNIQUE INDEX "categories_organization_id_name_key" ON "categories"("organization_id", "name");
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_sku_key";
ALTER TABLE "products" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "products_organization_id_idx" ON "products"("organization_id");
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouses" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "warehouses_organization_id_idx" ON "warehouses"("organization_id");
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "inventory_organization_id_idx" ON "inventory"("organization_id");
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_transactions" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "inventory_transactions_organization_id_idx" ON "inventory_transactions"("organization_id");
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_email_key";
ALTER TABLE "customers" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "customers_organization_id_idx" ON "customers"("organization_id");
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email");
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_email_key";
ALTER TABLE "suppliers" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "suppliers_organization_id_idx" ON "suppliers"("organization_id");
CREATE UNIQUE INDEX "suppliers_organization_id_email_key" ON "suppliers"("organization_id", "email");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_orders" DROP CONSTRAINT IF EXISTS "sales_orders_order_number_key";
ALTER TABLE "sales_orders" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "sales_orders_organization_id_idx" ON "sales_orders"("organization_id");
CREATE UNIQUE INDEX "sales_orders_organization_id_order_number_key" ON "sales_orders"("organization_id", "order_number");
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_order_number_key";
ALTER TABLE "purchase_orders" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "purchase_orders_organization_id_idx" ON "purchase_orders"("organization_id");
CREATE UNIQUE INDEX "purchase_orders_organization_id_order_number_key" ON "purchase_orders"("organization_id", "order_number");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_invoice_number_key";
ALTER TABLE "invoices" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "invoices_organization_id_idx" ON "invoices"("organization_id");
CREATE UNIQUE INDEX "invoices_organization_id_invoice_number_key" ON "invoices"("organization_id", "invoice_number");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD COLUMN "organization_id" INTEGER NOT NULL;
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;