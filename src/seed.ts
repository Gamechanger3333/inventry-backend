import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "./lib/prisma";

async function seed() {
  console.log("🌱 Seeding database...");

  // Demo organization (tenant) — every row below hangs off this.
  const org = await prisma.organization.upsert({
    where: { slug: "nexus-demo" },
    update: {},
    create: { name: "Nexus Demo Co.", slug: "nexus-demo" },
  });
  console.log(`🏢 Organization: ${org.name} (${org.slug})`);

  // Admin user
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

  // Categories
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
  console.log(`📦 Created ${categories.length} categories`);

  // Warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, organizationId: org.id, name: "Main Warehouse", location: "123 Storage Blvd, City" },
  });
  console.log(`🏭 Warehouse: ${warehouse.name}`);

  // Products
  const products = await Promise.all([
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "ELEC-001" } },
      update: {},
      create: {
        organizationId: org.id,
        name: "Wireless Headphones",
        sku: "ELEC-001",
        description: "Premium noise-cancelling headphones",
        price: 99.99,
        costPrice: 45.00,
        categoryId: categories[0].id,
        reorderPoint: 10,
      },
    }),
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "ELEC-002" } },
      update: {},
      create: {
        organizationId: org.id,
        name: "USB-C Hub",
        sku: "ELEC-002",
        description: "7-in-1 USB-C hub adapter",
        price: 49.99,
        costPrice: 18.00,
        categoryId: categories[0].id,
        reorderPoint: 15,
      },
    }),
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "CLOTH-001" } },
      update: {},
      create: {
        organizationId: org.id,
        name: "Cotton T-Shirt",
        sku: "CLOTH-001",
        description: "100% cotton unisex t-shirt",
        price: 24.99,
        costPrice: 8.00,
        categoryId: categories[1].id,
        reorderPoint: 20,
      },
    }),
    prisma.product.upsert({
      where: { organizationId_sku: { organizationId: org.id, sku: "OFF-001" } },
      update: {},
      create: {
        organizationId: org.id,
        name: "A4 Paper (500 sheets)",
        sku: "OFF-001",
        description: "High quality office paper",
        price: 8.99,
        costPrice: 3.50,
        categoryId: categories[3].id,
        reorderPoint: 50,
      },
    }),
  ]);
  console.log(`🛍️  Created ${products.length} products`);

  // Stock
  for (const product of products) {
    await prisma.inventory.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: {},
      create: { organizationId: org.id, productId: product.id, warehouseId: warehouse.id, quantity: 100 },
    });
  }
  console.log("📊 Stock initialized");

  // Customers
  const customers = await Promise.all([
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
  console.log(`👥 Created ${customers.length} customers`);

  // Suppliers
  const suppliers = await Promise.all([
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
  console.log(`🏢 Created ${suppliers.length} suppliers`);

  console.log("\n✅ Seed complete!");
  console.log("📧 Login: admin@nexus.com / password123");
  console.log(`🏢 Organization: ${org.name}`);
}

seed()
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
