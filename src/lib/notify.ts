import prisma from "./prisma";
import { getIO } from "./realtime";
import { sendLowStockAlertEmail } from "./email";

type LowStockRow = {
  productId: number;
  warehouseId: number;
  quantity: number;
  product: { name: string; sku: string; reorderPoint: number };
  warehouse: { name: string };
};

/**
 * Central place for "stock just dropped at/below reorder point" handling.
 * Called from every code path that can move stock down (manual adjust,
 * transfer-out, sale completion) so the three call sites can't silently
 * drift out of sync with each other the way the sale-completion path
 * originally did (it never called anything like this at all).
 *
 * Does three things, each best-effort and independent of the others:
 *  1. Writes a Notification row (always shown in the in-app bell).
 *  2. Emits a websocket event to everyone currently viewing this org's
 *     dashboard, for live-without-refresh badges.
 *  3. Emails the org's Administrators, since a DB-only notification is
 *     invisible to someone who isn't currently in the app.
 */
export async function raiseLowStockAlerts(organizationId: number, rows: LowStockRow[]): Promise<void> {
  const low = rows.filter((r) => r.quantity <= r.product.reorderPoint);
  if (low.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: low.map((row) => ({
        organizationId,
        type: "low_stock",
        title: "Low Stock Alert",
        message: `${row.product.name} (${row.product.sku}) is below reorder point in ${row.warehouse.name}. Current: ${row.quantity}, Reorder at: ${row.product.reorderPoint}`,
        data: { productId: row.productId, warehouseId: row.warehouseId, quantity: row.quantity },
      })),
    });
  } catch (err) {
    console.error("Failed to write low-stock notifications:", err);
  }

  try {
    getIO()?.to(`org:${organizationId}`).emit("notification:low_stock", {
      items: low.map((r) => ({
        productId: r.productId,
        warehouseId: r.warehouseId,
        quantity: r.quantity,
        productName: r.product.name,
        sku: r.product.sku,
        warehouseName: r.warehouse.name,
        reorderPoint: r.product.reorderPoint,
      })),
    });
  } catch (err) {
    console.error("Failed to emit low-stock realtime event:", err);
  }

  try {
    const admins = await prisma.user.findMany({
      where: { organizationId, role: "Administrator" },
      select: { email: true },
    });
    if (admins.length > 0) {
      await Promise.all(
        admins.map((a) =>
          sendLowStockAlertEmail(
            a.email,
            low.map((r) => ({
              name: r.product.name,
              sku: r.product.sku,
              quantity: r.quantity,
              reorderPoint: r.product.reorderPoint,
              warehouseName: r.warehouse.name,
            }))
          ).catch((err) => console.error(`Failed to email low-stock alert to ${a.email}:`, err))
        )
      );
    }
  } catch (err) {
    console.error("Failed to send low-stock alert emails:", err);
  }
}
