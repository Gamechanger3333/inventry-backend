import { Router, Response } from "express";
import prisma from "../lib/prisma";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();

function genInvoiceNumber(): string {
  return `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function formatInvoice(inv: any) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerId,
    customerName: inv.customer?.name ?? null,
    salesOrderId: inv.salesOrderId,
    status: inv.status,
    subtotal: Number(inv.subtotal),
    tax: Number(inv.tax),
    total: Number(inv.total),
    dueDate: inv.dueDate.toISOString(),
    paidAt: inv.paidAt?.toISOString() ?? null,
    notes: inv.notes,
    createdAt: inv.createdAt.toISOString(),
  };
}

// GET /api/invoices
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, customerId } = req.query as Record<string, string>;

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(status && { status }),
        ...(customerId && { customerId: parseInt(customerId) }),
      },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(invoices.map(formatInvoice));
  } catch (err) {
    console.error("List invoices error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/invoices
router.post("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { customerId, salesOrderId, subtotal, tax, dueDate, notes } = req.body;
    if (!customerId || !dueDate) {
      res.status(400).json({ error: "Customer and dueDate are required" });
      return;
    }

    const sub = subtotal || 0;
    const taxAmt = tax || 0;
    const total = sub + taxAmt;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: genInvoiceNumber(),
        customerId,
        salesOrderId: salesOrderId || null,
        status: "draft",
        subtotal: sub,
        tax: taxAmt,
        total,
        dueDate: new Date(dueDate),
        notes,
      },
      include: { customer: { select: { name: true } } },
    });

    res.status(201).json(formatInvoice(invoice));
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/invoices/:id
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { customer: { select: { name: true } } },
    });
    if (!invoice) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(formatInvoice(invoice));
  } catch (err) {
    console.error("Get invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/invoices/:id
router.patch("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { status, notes, dueDate } = req.body;

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes }),
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
        // Auto-set paidAt when marking as paid
        ...(status === "paid" && { paidAt: new Date() }),
      },
      include: { customer: { select: { name: true } } },
    });

    res.json(formatInvoice(invoice));
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Update invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/invoices/:id
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    await prisma.invoice.delete({ where: { id } });
    res.json({ message: "Deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    console.error("Delete invoice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
