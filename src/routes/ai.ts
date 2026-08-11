import { Router, Request, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { publicAiLimiter } from "../middleware/rateLimit";
import prisma from "../lib/prisma";

const router = Router();

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const LANGUAGE_INSTRUCTION = `Always reply in the same language and script the user just wrote in — including Roman Urdu/Hindi (Latin-script transliteration), Urdu/Hindi/Arabic script, Spanish, French, or any other language. Detect it from their latest message, don't ask which language to use, and don't switch languages mid-conversation unless the user does. Match their tone (casual vs formal) too.`;

const SYSTEM_PROMPT = `You are an AI assistant for Nexus, an Inventory & Sales Management System.
You have tools that query the real, live database — use them whenever a question depends on actual data (stock levels, sales figures, specific products/customers, invoices, purchase orders, warehouses). Never guess or make up numbers, names, or SKUs; call a tool to find out. If no tool covers what's being asked, say so honestly instead of inventing an answer.

You help users with:
- Understanding inventory levels, product stock, and reorder recommendations
- Analyzing sales trends, revenue data, and customer insights
- Purchase order management and supplier coordination
- Generating reports and business insights
- Answering questions about how to use the system

${LANGUAGE_INSTRUCTION}

Be concise, professional, and data-focused. Lead with the concrete numbers/names the tools return. If a request is ambiguous, ask one short clarifying question instead of guessing which tool to call.`;

// Used on the public marketing site (landing page, login/signup, etc.)
// where there is no logged-in user and therefore no business data to talk
// about. Scoped to product/sales questions only.
const PUBLIC_SYSTEM_PROMPT = `You are the pre-sales assistant on the Nexus marketing website. Nexus is an all-in-one inventory and sales management SaaS with: multi-warehouse inventory tracking with low-stock alerts, sales & purchase order management, customer/supplier CRM, invoicing, profit & loss and inventory reports, and role-based accounts.

You help visitors understand what Nexus does, whether it fits their business, and how to get started (sign up is free, no credit card required; there's also a demo login: sarah@acmecorp.com / password123).

${LANGUAGE_INSTRUCTION}

If someone reports a login/account problem, don't just repeat "check your credentials" — walk through it step by step: (1) confirm they're using the exact email they signed up with, no typos or extra spaces, (2) check Caps Lock / autocorrect on mobile, (3) try the demo login to confirm the platform itself is reachable, (4) use the "Forgot password?" link on the login page to reset it, (5) if it still fails after a reset, it's likely account-specific and they should sign up fresh or contact support — you (the pre-sales widget) can't look up or fix their actual account since you have no access to user data.

You do NOT have access to any specific user's account, inventory, or sales data - if asked about "my" stock or orders, tell them to sign in first and use the in-app assistant. Keep answers short (2-4 sentences) and friendly. Don't discuss anything unrelated to Nexus or general inventory/sales-management best practices.`;

async function callGroq(messages: { role: string; content: string }[], systemPrompt: string, maxTokens: number) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return "AI assistant is not configured. Please set GROQ_API_KEY in your .env file. Get a free key at https://console.groq.com";
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Groq API error:", errText);
    throw new Error("AI service error");
  }

  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ─────────────────────────────────────────────────────────────────
// RAG: instead of naive vector search over documents (this app has
// structured relational data, not free text), the assistant is given
// a set of "tools" it can call. The model decides which ones it needs
// for a given question, we run the real Prisma query, feed the result
// back to it, and it answers grounded in that live data. This is more
// accurate than embedding-based retrieval for tabular business data.
// ─────────────────────────────────────────────────────────────────

const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_inventory_overview",
      description: "Get a summary of current inventory: total distinct products, total units in stock across all warehouses, total inventory value, and how many products are at/below their reorder point.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock_items",
      description: "List products that are at or below their reorder point, with current quantity, reorder point, and which warehouse they're low in.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search products by name or SKU. Returns price, cost, status, category, and stock quantity per warehouse for each match.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Product name or SKU (partial match)" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description: "Get total revenue, number of orders, and average order value from all sales orders (all-time).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_products",
      description: "Get the best-selling products ranked by total units sold across all sales orders.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "How many to return, default 5" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_customers",
      description: "Search customers by name or email. Returns contact info, number of orders, and total amount spent.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Customer name or email (partial match)" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pending_invoices",
      description: "List invoices that are pending or overdue, with amount, due date, and customer name.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_purchase_orders_status",
      description: "Get counts and details of purchase orders by status (draft, pending, ordered, received), including which supplier and expected delivery date.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_warehouses_overview",
      description: "List all warehouses with their location and total units of stock currently held in each.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const num = (d: unknown) => Number(d ?? 0);

async function executeTool(name: string, args: any): Promise<unknown> {
  switch (name) {
    case "get_inventory_overview": {
      const [productCount, inventory] = await Promise.all([
        prisma.product.count(),
        prisma.inventory.findMany({ include: { product: { select: { reorderPoint: true, price: true } } } }),
      ]);
      const totalUnits = inventory.reduce((sum, i) => sum + i.quantity, 0);
      const totalValue = inventory.reduce((sum, i) => sum + i.quantity * num(i.product.price), 0);
      const lowStockCount = inventory.filter((i) => i.quantity <= i.product.reorderPoint).length;
      return { totalProducts: productCount, totalUnitsInStock: totalUnits, totalInventoryValue: Math.round(totalValue * 100) / 100, lowStockCount };
    }
    case "get_low_stock_items": {
      const inventory = await prisma.inventory.findMany({
        include: { product: { select: { name: true, sku: true, reorderPoint: true } }, warehouse: { select: { name: true } } },
      });
      return inventory
        .filter((i) => i.quantity <= i.product.reorderPoint)
        .map((i) => ({ product: i.product.name, sku: i.product.sku, warehouse: i.warehouse.name, quantity: i.quantity, reorderPoint: i.product.reorderPoint }));
    }
    case "search_products": {
      const q = String(args?.query ?? "").trim();
      const products = await prisma.product.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] },
        include: { category: { select: { name: true } }, inventory: { include: { warehouse: { select: { name: true } } } } },
        take: 10,
      });
      return products.map((p) => ({
        name: p.name,
        sku: p.sku,
        price: num(p.price),
        costPrice: num(p.costPrice),
        status: p.status,
        category: p.category?.name ?? null,
        stockByWarehouse: p.inventory.map((i) => ({ warehouse: i.warehouse.name, quantity: i.quantity })),
        totalStock: p.inventory.reduce((s, i) => s + i.quantity, 0),
      }));
    }
    case "get_sales_summary": {
      const orders = await prisma.salesOrder.findMany({ select: { total: true } });
      const totalRevenue = orders.reduce((s, o) => s + num(o.total), 0);
      return {
        totalOrders: orders.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        averageOrderValue: orders.length ? Math.round((totalRevenue / orders.length) * 100) / 100 : 0,
      };
    }
    case "get_top_products": {
      const limit = Math.min(Math.max(Number(args?.limit) || 5, 1), 20);
      const grouped = await prisma.salesOrderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: limit,
      });
      const products = await prisma.product.findMany({ where: { id: { in: grouped.map((g) => g.productId) } } });
      return grouped.map((g) => {
        const p = products.find((pr) => pr.id === g.productId);
        return { product: p?.name ?? "Unknown", sku: p?.sku, unitsSold: g._sum.quantity ?? 0, revenue: Math.round(num(g._sum.total) * 100) / 100 };
      });
    }
    case "search_customers": {
      const q = String(args?.query ?? "").trim();
      const customers = await prisma.customer.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] },
        include: { salesOrders: { select: { total: true } } },
        take: 10,
      });
      return customers.map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        city: c.city,
        orderCount: c.salesOrders.length,
        totalSpent: Math.round(c.salesOrders.reduce((s, o) => s + num(o.total), 0) * 100) / 100,
      }));
    }
    case "get_pending_invoices": {
      const invoices = await prisma.invoice.findMany({
        where: { status: { in: ["pending", "draft"] } },
        include: { customer: { select: { name: true } } },
        orderBy: { dueDate: "asc" },
        take: 20,
      });
      const now = new Date();
      return invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer.name,
        total: num(inv.total),
        dueDate: inv.dueDate.toISOString().slice(0, 10),
        overdue: inv.dueDate < now,
      }));
    }
    case "get_purchase_orders_status": {
      const pos = await prisma.purchaseOrder.findMany({
        include: { supplier: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return pos.map((po) => ({
        orderNumber: po.orderNumber,
        supplier: po.supplier.name,
        status: po.status,
        total: num(po.total),
        expectedDate: po.expectedDate ? po.expectedDate.toISOString().slice(0, 10) : null,
      }));
    }
    case "get_warehouses_overview": {
      const warehouses = await prisma.warehouse.findMany({ include: { inventory: { select: { quantity: true } } } });
      return warehouses.map((w) => ({
        name: w.name,
        location: w.location,
        isActive: w.isActive,
        totalUnitsStocked: w.inventory.reduce((s, i) => s + i.quantity, 0),
      }));
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Runs the tool-calling loop: ask the model, execute any tools it requests,
// feed results back, repeat (bounded) until it gives a final text answer.
async function chatWithTools(userMessages: { role: string; content: string }[], systemPrompt: string, maxTokens: number) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return "AI assistant is not configured. Please set GROQ_API_KEY in your .env file. Get a free key at https://console.groq.com";
  }

  const messages: any[] = [{ role: "system", content: systemPrompt }, ...userMessages];

  for (let round = 0; round < 4; round++) {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        tools: AI_TOOLS,
        tool_choice: "auto",
        max_tokens: maxTokens,
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", errText);
      throw new Error("AI service error");
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0]?.message;
    if (!choice) return "";

    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      return choice.content ?? "";
    }

    // Model wants data — run each requested tool against the real database.
    messages.push(choice);
    for (const call of choice.tool_calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* ignore malformed args */ }
      const result = await executeTool(call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return "I looked into that but couldn't put together a complete answer — could you rephrase or ask about one thing at a time?";
}

function parseMessages(body: any): { role: string; content: string }[] | null {
  if (body.messages && Array.isArray(body.messages)) return body.messages;
  if (body.message && typeof body.message === "string") return [{ role: "user", content: body.message }];
  return null;
}

// GET /api/ai/insights
// Computed from real data rather than static copy, so the numbers/names
// always reflect what's actually in the database.
router.get("/insights", requireAuth, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const insights: { id: number; type: string; title: string; priority: string; description: string }[] = [];
    let nextId = 1;

    // 1. Low stock items
    const inventory = await prisma.inventory.findMany({
      include: { product: { select: { name: true, sku: true, reorderPoint: true } } },
    });
    const lowStock = inventory.filter((inv) => inv.quantity <= inv.product.reorderPoint);
    if (lowStock.length > 0) {
      const worst = [...lowStock].sort((a, b) => a.quantity - b.quantity)[0];
      insights.push({
        id: nextId++,
        type: "inventory",
        title: `${lowStock.length} item${lowStock.length === 1 ? "" : "s"} below reorder point`,
        priority: lowStock.length >= 5 ? "high" : "medium",
        description: `${worst.product.name} (${worst.product.sku}) is critically low at ${worst.quantity} units. Consider raising a purchase order soon.`,
      });
    } else {
      insights.push({
        id: nextId++,
        type: "inventory",
        title: "Stock levels healthy",
        priority: "low",
        description: "No products are currently below their reorder point.",
      });
    }

    // 2. Top-selling product (by quantity across completed sales)
    const topLine = await prisma.salesOrderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 1,
    });
    if (topLine.length > 0 && topLine[0]._sum.quantity) {
      const product = await prisma.product.findUnique({ where: { id: topLine[0].productId } });
      if (product) {
        insights.push({
          id: nextId++,
          type: "sales",
          title: "Top-selling product",
          priority: "medium",
          description: `${product.name} is your best seller with ${topLine[0]._sum.quantity} units sold. Make sure it stays well stocked.`,
        });
      }
    }

    // 3. Pending / overdue invoices
    const [pendingCount, overdueCount] = await Promise.all([
      prisma.invoice.count({ where: { status: "pending" } }),
      prisma.invoice.count({ where: { status: "pending", dueDate: { lt: new Date() } } }),
    ]);
    if (overdueCount > 0) {
      insights.push({
        id: nextId++,
        type: "finance",
        title: `${overdueCount} invoice${overdueCount === 1 ? "" : "s"} overdue`,
        priority: "high",
        description: `${overdueCount} invoice${overdueCount === 1 ? " is" : "s are"} past due date. Follow up with the customer(s) to protect cash flow.`,
      });
    } else if (pendingCount > 0) {
      insights.push({
        id: nextId++,
        type: "finance",
        title: `${pendingCount} invoice${pendingCount === 1 ? "" : "s"} pending`,
        priority: "medium",
        description: `${pendingCount} invoice${pendingCount === 1 ? " is" : "s are"} awaiting payment. None are overdue yet.`,
      });
    }

    // 4. Pending purchase orders (procurement follow-up)
    const pendingPOs = await prisma.purchaseOrder.count({ where: { status: { in: ["pending", "ordered"] } } });
    if (pendingPOs > 0) {
      insights.push({
        id: nextId++,
        type: "purchasing",
        title: `${pendingPOs} purchase order${pendingPOs === 1 ? "" : "s"} in progress`,
        priority: "low",
        description: `${pendingPOs} purchase order${pendingPOs === 1 ? " is" : "s are"} not yet received. Confirm expected delivery dates with your supplier(s).`,
      });
    }

    res.json(insights);
  } catch (err) {
    console.error("AI insights error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai/chat — authenticated, has full business-assistant framing
router.post("/chat", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const messages = parseMessages(req.body);
    if (!messages) {
      res.status(400).json({ error: "Provide message (string) or messages (array)" });
      return;
    }

    const content = await chatWithTools(messages.slice(-20), SYSTEM_PROMPT, 1024);
    res.json({ message: content, reply: content, role: "assistant" });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/ai/public-chat — no auth required, powers the assistant widget
// on the marketing site (landing page, login/signup, etc). Scoped to a
// product-Q&A system prompt and kept short since it's unauthenticated and
// has no per-user rate limiting yet - don't expand its capabilities without
// adding real abuse protection (e.g. IP rate limiting) first.
router.post("/public-chat", publicAiLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const messages = parseMessages(req.body);
    if (!messages) {
      res.status(400).json({ error: "Provide message (string) or messages (array)" });
      return;
    }

    const lastMessages = messages.slice(-6); // shorter history than the authenticated chat
    const tooLong = lastMessages.some((m) => typeof m.content === "string" && m.content.length > 1000);
    if (tooLong) {
      res.status(400).json({ error: "Message is too long" });
      return;
    }

    const content = await callGroq(lastMessages, PUBLIC_SYSTEM_PROMPT, 450);
    res.json({ message: content, reply: content, role: "assistant" });
  } catch (err) {
    console.error("AI public chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;