import { Router, Request, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import prisma from "../lib/prisma";

const router = Router();

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are an AI assistant for Nexus, an Inventory & Sales Management System. 
You help users with:
- Understanding inventory levels, product stock, and reorder recommendations
- Analyzing sales trends, revenue data, and customer insights
- Purchase order management and supplier coordination
- Generating reports and business insights
- Answering questions about how to use the system

Be concise, professional, and data-focused.`;

// Used on the public marketing site (landing page, login/signup, etc.)
// where there is no logged-in user and therefore no business data to talk
// about. Scoped to product/sales questions only.
const PUBLIC_SYSTEM_PROMPT = `You are the pre-sales assistant on the Nexus marketing website. Nexus is an all-in-one inventory and sales management SaaS with: multi-warehouse inventory tracking with low-stock alerts, sales & purchase order management, customer/supplier CRM, invoicing, profit & loss and inventory reports, and role-based accounts.

You help visitors understand what Nexus does, whether it fits their business, and how to get started (sign up is free, no credit card required; there's also a demo login: sarah@acmecorp.com / password123).

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

    const content = await callGroq(messages.slice(-20), SYSTEM_PROMPT, 1024);
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
router.post("/public-chat", async (req: Request, res: Response): Promise<void> => {
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

    const content = await callGroq(lastMessages, PUBLIC_SYSTEM_PROMPT, 300);
    res.json({ message: content, reply: content, role: "assistant" });
  } catch (err) {
    console.error("AI public chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;