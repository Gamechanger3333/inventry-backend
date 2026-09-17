import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "./lib/prisma";
import { resetAndSeedDemoOrg } from "./lib/demoSeed";

// Kept in env (not hardcoded) so the password can be rotated without a code
// change, and so it's documented in exactly one place (.env.example).
// Falls back to a sensible default only for convenience in fresh local
// setups — production deployments should still set these explicitly.
const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL || "demo@nexus.com";
const DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD || "Demo@1234";

async function seed() {
  console.log("🌱 Seeding database...");

  // ── Regular demo/dev organization (unaffected by this change) ──
  const org = await prisma.organization.upsert({
    where: { slug: "nexus-demo" },
    update: {},
    create: { name: "Nexus Demo Co.", slug: "nexus-demo" },
  });
  console.log(`🏢 Organization: ${org.name} (${org.slug})`);

  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@nexus.com" },
    update: {},
    create: {
      organizationId: org.id,
      name: "Admin User",
      email: "admin@nexus.com",
      passwordHash,
      role: "Administrator",
      emailVerified: true,
    },
  });
  console.log(`👤 User: ${admin.email} (password: password123)`);

  const categories = await Promise.all([
    prisma.category.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "Electronics" } },
      update: {},
      create: { organizationId: org.id, name: "Electronics", description: "Electronic products", color: "#3B82F6" },
    }),
    prisma.category.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "Clothing" } },
      update: {},
      create: { organizationId: org.id, name: "Clothing", description: "Apparel and accessories", color: "#8B5CF6" },
    }),
    prisma.category.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "Food & Beverage" } },
      update: {},
      create: { organizationId: org.id, name: "Food & Beverage", description: "Food and drinks", color: "#10B981" },
    }),
    prisma.category.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "Office Supplies" } },
      update: {},
      create: { organizationId: org.id, name: "Office Supplies", description: "Office equipment and supplies", color: "#F59E0B" },
    }),
  ]);

  const warehouse = await prisma.warehouse.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, organizationId: org.id, name: "Main Warehouse", location: "123 Storage Blvd, City" },
  });

  const products = await Promise.all([
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "ELEC-001" } },
      update: {},
      create: { organizationId: org.id, name: "Wireless Headphones", sku: "ELEC-001", description: "Premium noise-cancelling headphones", price: 99.99, costPrice: 45.0, categoryId: categories[0].id, reorderPoint: 10 },
    }),
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "ELEC-002" } },
      update: {},
      create: { organizationId: org.id, name: "USB-C Hub", sku: "ELEC-002", description: "7-in-1 USB-C hub adapter", price: 49.99, costPrice: 18.0, categoryId: categories[0].id, reorderPoint: 15 },
    }),
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "CLOTH-001" } },
      update: {},
      create: { organizationId: org.id, name: "Cotton T-Shirt", sku: "CLOTH-001", description: "100% cotton unisex t-shirt", price: 24.99, costPrice: 8.0, categoryId: categories[1].id, reorderPoint: 20 },
    }),
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "OFF-001" } },
      update: {},
      create: { organizationId: org.id, name: "A4 Paper (500 sheets)", sku: "OFF-001", description: "High quality office paper", price: 8.99, costPrice: 3.5, categoryId: categories[3].id, reorderPoint: 50 },
    }),
  ]);

  for (const product of products) {
    await prisma.inventory.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: {},
      create: { organizationId: org.id, productId: product.id, warehouseId: warehouse.id, quantity: 100 },
    });
  }

  await Promise.all([
    prisma.customer.upsert({
      where: { organizationId_email: { organizationId: org.id, email: "alice@example.com" } },
      update: {},
      create: { organizationId: org.id, name: "Alice Johnson", email: "alice@example.com", phone: "+1-555-0101", city: "New York" },
    }),
    prisma.customer.upsert({
      where: { organizationId_email: { organizationId: org.id, email: "bob@example.com" } },
      update: {},
      create: { organizationId: org.id, name: "Bob Smith", email: "bob@example.com", phone: "+1-555-0102", city: "Los Angeles" },
    }),
  ]);

  await Promise.all([
    prisma.supplier.upsert({
      where: { organizationId_email: { organizationId: org.id, email: "tech@supplier.com" } },
      update: {},
      create: { organizationId: org.id, name: "Tech Supply Co.", email: "tech@supplier.com", phone: "+1-555-0201", contactPerson: "Mike Chen" },
    }),
    prisma.supplier.upsert({
      where: { organizationId_email: { organizationId: org.id, email: "office@supplier.com" } },
      update: {},
      create: { organizationId: org.id, name: "Office Depot Pro", email: "office@supplier.com", phone: "+1-555-0202", contactPerson: "Sarah Lee" },
    }),
  ]);

  console.log("✅ Regular demo/dev org seeded");

  // ── "Try Demo Account" organization — fully isolated from the org above ──
  // Kept separate on purpose: this is the org every "Try Demo Account"
  // click resets, so it must never share rows with the admin@nexus.com
  // workspace (or any real customer's workspace).
  const demoOrg = await prisma.organization.upsert({
    where: { slug: "public-demo" },
    update: {},
    create: { name: "Nexus Demo Workspace", slug: "public-demo" },
  });

  const demoPasswordHash = await bcrypt.hash(DEMO_USER_PASSWORD, 10);
  const demoUser = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: { organizationId: demoOrg.id },
    create: {
      organizationId: demoOrg.id,
      name: "Demo User",
      email: DEMO_USER_EMAIL,
      passwordHash: demoPasswordHash,
      // Administrator (not a restricted role) is intentional here: this
      // project's whole pitch is its 6-tier RBAC + AI assistant + reports,
      // and a recruiter clicking "Try Demo" should be able to see all of
      // it in one click rather than hitting permission walls partway
      // through. A real multi-user company workspace would NOT default
      // new signups to Administrator (see routes/auth.ts register) —
      // this exception is specific to the public demo account.
      role: "Administrator",
      emailVerified: true,
    },
  });
  console.log(`🎯 Demo account: ${demoUser.email} (password from DEMO_USER_PASSWORD env var)`);

  await resetAndSeedDemoOrg(demoOrg.id);
  console.log("✅ Demo workspace populated with sample data");

  console.log("\n✅ Seed complete!");
  console.log("📧 Dev login: admin@nexus.com / password123");
  console.log(`🎯 Public demo login: ${demoUser.email} / (see DEMO_USER_PASSWORD)`);
}

seed()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
