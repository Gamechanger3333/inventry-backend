import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";

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

// GET /api/ai/insights
router.get("/insights", requireAuth, (_req: AuthRequest, res: Response): void => {
  res.json([
    {
      id: 1,
      type: "inventory",
      title: "Low Stock Alert",
      priority: "high",
      description: "Monitor low-stock items and set reorder points to avoid stockouts.",
    },
    {
      id: 2,
      type: "sales",
      title: "Top Products Review",
      priority: "medium",
      description: "Review your top-selling products to optimize purchasing decisions.",
    },
    {
      id: 3,
      type: "finance",
      title: "Pending Invoices",
      priority: "medium",
      description: "Check pending invoices to improve cash flow.",
    },
  ]);
});

// POST /api/ai/chat
router.post("/chat", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log("AI chat body:", JSON.stringify(req.body));

    // Accept { message: "..." } or { messages: [...] }
    let messages: { role: string; content: string }[] = [];

    if (req.body.messages && Array.isArray(req.body.messages)) {
      messages = req.body.messages;
    } else if (req.body.message && typeof req.body.message === "string") {
      messages = [{ role: "user", content: req.body.message }];
    } else {
      res.status(400).json({ error: "Provide message (string) or messages (array)" });
      return;
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      const fallback = "AI assistant is not configured. Please set GROQ_API_KEY in your .env file. Get a free key at https://console.groq.com";
      res.json({ message: fallback, reply: fallback, role: "assistant" });
      return;
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages.slice(-20),
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Groq API error:", errText);
      res.status(502).json({ error: "AI service error", detail: errText });
      return;
    }

    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({ message: content, reply: content, role: "assistant" });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;