import prisma from "./prisma";

/**
 * Wipes and re-seeds ONE organization's business data with a realistic,
 * varied dataset. Called on every "Try Demo Account" login (see
 * routes/auth.ts POST /demo-login), so every visitor gets a clean,
 * populated workspace regardless of what earlier visitors added, edited,
 * or deleted — without needing a cron job or any extra infrastructure.
 *
 * Deliberately scoped to a single `organizationId` and nothing else: this
 * project is multi-tenant, so wiping this organization's rows can never
 * touch a real customer's data, no matter how many times a recruiter
 * clicks the demo button.
 *
 * Deletion order matters (children before parents) since none of these
 * relations cascade at the DB level.
 */
export async function resetAndSeedDemoOrg(organizationId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // ---- 1. Wipe existing business data for this org only ----
    await tx.notification.deleteMany({ where: { organizationId } });
    await tx.salesOrderItem.deleteMany({ where: { order: { organizationId } } });
    await tx.salesOrder.deleteMany({ where: { organizationId } });
    await tx.purchaseOrderItem.deleteMany({ where: { order: { organizationId } } });
    await tx.purchaseOrder.deleteMany({ where: { organizationId } });
    await tx.invoice.deleteMany({ where: { organizationId } });
    await tx.inventoryTransaction.deleteMany({ where: { organizationId } });
    await tx.inventory.deleteMany({ where: { organizationId } });
    await tx.product.deleteMany({ where: { organizationId } });
    await tx.customer.deleteMany({ where: { organizationId } });
    await tx.supplier.deleteMany({ where: { organizationId } });
    await tx.warehouse.deleteMany({ where: { organizationId } });
    await tx.category.deleteMany({ where: { organizationId } });

    // ---- 2. Categories ----
    const categoryDefs = [
      { name: "Electronics", color: "#3B82F6" },
      { name: "Apparel", color: "#8B5CF6" },
      { name: "Home & Kitchen", color: "#F59E0B" },
      { name: "Office Supplies", color: "#10B981" },
      { name: "Sports & Outdoors", color: "#EF4444" },
    ];
    const categories = [];
    for (const c of categoryDefs) {
      categories.push(
        await tx.category.create({
          data: { organizationId, name: c.name, description: `${c.name} products`, color: c.color },
        })
      );
    }

    // ---- 3. Warehouses ----
    const warehouses = await Promise.all([
      tx.warehouse.create({ data: { organizationId, name: "Main Distribution Center", location: "Lahore, Punjab" } }),
      tx.warehouse.create({ data: { organizationId, name: "West Coast Hub", location: "Karachi, Sindh" } }),
    ]);

    // ---- 4. Products (20, spread across categories, varied stock) ----
    const productPool: { name: string; base: number; cat: number }[] = [
      { name: "Wireless Headphones", base: 89.99, cat: 0 },
      { name: "USB-C Hub 7-in-1", base: 44.99, cat: 0 },
      { name: "Mechanical Keyboard", base: 129.99, cat: 0 },
      { name: "Wireless Mouse", base: 29.99, cat: 0 },
      { name: "27\" Monitor", base: 249.99, cat: 0 },
      { name: "Power Bank 20000mAh", base: 34.99, cat: 0 },
      { name: "Cotton T-Shirt", base: 19.99, cat: 1 },
      { name: "Denim Jacket", base: 79.99, cat: 1 },
      { name: "Running Shoes", base: 89.99, cat: 1 },
      { name: "Wool Sweater", base: 59.99, cat: 1 },
      { name: "Ceramic Mug Set", base: 24.99, cat: 2 },
      { name: "Non-Stick Frying Pan", base: 39.99, cat: 2 },
      { name: "Electric Kettle", base: 34.99, cat: 2 },
      { name: "Bath Towel Set", base: 29.99, cat: 2 },
      { name: "A4 Paper Ream (500 sheets)", base: 6.99, cat: 3 },
      { name: "Ballpoint Pen Pack (12)", base: 4.99, cat: 3 },
      { name: "Desk Organizer", base: 18.99, cat: 3 },
      { name: "Sticky Notes Bundle", base: 7.99, cat: 3 },
      { name: "Yoga Mat", base: 24.99, cat: 4 },
      { name: "Adjustable Dumbbell Set", base: 149.99, cat: 4 },
    ];

    const products = [];
    for (let i = 0; i < productPool.length; i++) {
      const p = productPool[i];
      const sku = `DEMO-${(i + 1).toString().padStart(3, "0")}`;
      const reorderPoint = 10 + (i % 4) * 5; // 10, 15, 20, 25
      const product = await tx.product.create({
        data: {
          organizationId,
          name: p.name,
          sku,
          description: `${p.name} — demo sample product.`,
          price: p.base,
          costPrice: Math.round(p.base * 0.45 * 100) / 100,
          status: "active",
          categoryId: categories[p.cat].id,
          reorderPoint,
        },
      });
      products.push(product);

      // Stock split across both warehouses. Every 6th product is
      // intentionally low/out of stock so the dashboard's low-stock
      // widget, notifications, and AI insights have something to show.
      const isLow = i % 6 === 0;
      const mainQty = isLow ? Math.max(0, reorderPoint - 4) : reorderPoint + 15 + (i % 5) * 10;
      const westQty = isLow ? 0 : 8 + (i % 7) * 6;

      await tx.inventory.create({
        data: { organizationId, productId: product.id, warehouseId: warehouses[0].id, quantity: mainQty },
      });
      await tx.inventory.create({
        data: { organizationId, productId: product.id, warehouseId: warehouses[1].id, quantity: westQty },
      });
    }

    // ---- 5. Customers (12) ----
    const customerNames = [
      ["Alice Johnson", "New York"], ["Bob Smith", "Los Angeles"], ["Carla Mendes", "Miami"],
      ["David Kim", "Seattle"], ["Elena Petrova", "Chicago"], ["Farid Khan", "Houston"],
      ["Grace Lee", "Boston"], ["Hassan Ali", "Lahore"], ["Isabella Rossi", "Austin"],
      ["Jack Turner", "Denver"], ["Kavya Iyer", "San Jose"], ["Liam O'Connor", "Portland"],
    ];
    const customers = [];
    for (let i = 0; i < customerNames.length; i++) {
      const [name, city] = customerNames[i];
      const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
      customers.push(
        await tx.customer.create({
          data: { organizationId, name, email, phone: `+1-555-01${(10 + i).toString().padStart(2, "0")}`, city, country: "USA" },
        })
      );
    }

    // ---- 6. Suppliers (5) ----
    const supplierDefs = [
      ["Tech Supply Co.", "Mike Chen"], ["Global Textiles Ltd.", "Sarah Lee"],
      ["Home Goods Direct", "Omar Farooq"], ["Office Depot Pro", "Priya Nair"],
      ["Outdoor Gear Wholesale", "Lucas Silva"],
    ];
    const suppliers = [];
    for (let i = 0; i < supplierDefs.length; i++) {
      const [name, contact] = supplierDefs[i];
      suppliers.push(
        await tx.supplier.create({
          data: {
            organizationId,
            name,
            email: `contact@${name.toLowerCase().replace(/[^a-z]+/g, "")}.com`,
            phone: `+1-555-02${(10 + i).toString().padStart(2, "0")}`,
            contactPerson: contact,
          },
        })
      );
    }

    // ---- 7. Sales orders (15, spread over the last ~90 days) ----
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const salesStatuses = ["completed", "completed", "completed", "completed", "pending", "cancelled"];
    for (let i = 0; i < 15; i++) {
      const customer = customers[i % customers.length];
      const status = salesStatuses[i % salesStatuses.length];
      const createdAt = new Date(now - Math.floor(Math.random() * 90) * dayMs);

      const lineCount = 1 + (i % 3);
      const items = [];
      let subtotal = 0;
      for (let l = 0; l < lineCount; l++) {
        const product = products[(i * 3 + l) % products.length];
        const quantity = 1 + ((i + l) % 5);
        const unitPrice = Number(product.price);
        const lineTotal = quantity * unitPrice;
        subtotal += lineTotal;
        items.push({ productId: product.id, quantity, unitPrice, discount: 0, total: lineTotal });
      }
      const tax = Math.round(subtotal * 0.08 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;

      await tx.salesOrder.create({
        data: {
          organizationId,
          orderNumber: `SO-DEMO-${(i + 1).toString().padStart(3, "0")}`,
          customerId: customer.id,
          status,
          subtotal: Math.round(subtotal * 100) / 100,
          tax,
          discount: 0,
          total,
          createdAt,
          items: { create: items },
        },
      });
    }

    // ---- 8. Purchase orders (6) ----
    const poStatuses = ["received", "received", "received", "pending", "draft", "ordered"];
    for (let i = 0; i < 6; i++) {
      const supplier = suppliers[i % suppliers.length];
      const warehouse = warehouses[i % warehouses.length];
      const status = poStatuses[i];
      const lineCount = 2 + (i % 3);
      const items = [];
      let total = 0;
      for (let l = 0; l < lineCount; l++) {
        const product = products[(i * 4 + l) % products.length];
        const quantity = 20 + (i + l) * 5;
        const unitCost = Number(product.costPrice);
        const lineTotal = quantity * unitCost;
        total += lineTotal;
        items.push({ productId: product.id, quantity, unitCost, total: lineTotal });
      }
      await tx.purchaseOrder.create({
        data: {
          organizationId,
          orderNumber: `PO-DEMO-${(i + 1).toString().padStart(3, "0")}`,
          supplierId: supplier.id,
          warehouseId: warehouse.id,
          status,
          total: Math.round(total * 100) / 100,
          expectedDate: new Date(now + (i - 2) * 5 * dayMs),
          items: { create: items },
        },
      });
    }

    // ---- 9. Invoices (8) ----
    const invStatuses = ["paid", "paid", "paid", "pending", "pending", "pending", "overdue", "overdue"];
    for (let i = 0; i < 8; i++) {
      const customer = customers[(i * 2) % customers.length];
      const status = invStatuses[i];
      const subtotal = 150 + i * 47.5;
      const tax = Math.round(subtotal * 0.08 * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;
      const dueDate = new Date(now + (status === "overdue" ? -10 - i : 10 + i) * dayMs);
      await tx.invoice.create({
        data: {
          organizationId,
          invoiceNumber: `INV-DEMO-${(i + 1).toString().padStart(3, "0")}`,
          customerId: customer.id,
          status: status === "overdue" ? "pending" : status, // schema has no distinct "overdue" enum; dueDate in the past + pending status is what the reports route treats as overdue
          subtotal: Math.round(subtotal * 100) / 100,
          tax,
          total,
          dueDate,
          paidAt: status === "paid" ? new Date(now - i * dayMs) : null,
        },
      });
    }

    // ---- 10. A few low-stock notifications, matching the intentionally-low products ----
    const lowStockProducts = products.filter((_, i) => i % 6 === 0);
    for (const p of lowStockProducts.slice(0, 5)) {
      await tx.notification.create({
        data: {
          organizationId,
          type: "low_stock",
          title: "Low Stock Alert",
          message: `${p.name} (${p.sku}) is below its reorder point in Main Distribution Center.`,
          data: { productId: p.id },
        },
      });
    }
  });
}
