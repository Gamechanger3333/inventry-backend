import { Router } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import categoriesRouter from "./categories";
import productsRouter from "./products";
import warehousesRouter from "./warehouses";
import inventoryRouter from "./inventory";
import customersRouter from "./customers";
import suppliersRouter from "./suppliers";
import salesRouter from "./sales";
import purchasesRouter from "./purchases";
import invoicesRouter from "./invoices";
import notificationsRouter from "./notifications";
import reportsRouter from "./reports";
import aiRouter from "./ai";

const router = Router();

router.use("/healthz", healthRouter);
router.use("/auth", authRouter);
router.use("/dashboard", dashboardRouter);
router.use("/categories", categoriesRouter);
router.use("/products", productsRouter);
router.use("/warehouses", warehousesRouter);
router.use("/inventory", inventoryRouter);
router.use("/customers", customersRouter);
router.use("/suppliers", suppliersRouter);
router.use("/sales", salesRouter);
router.use("/purchases", purchasesRouter);
router.use("/invoices", invoicesRouter);
router.use("/notifications", notificationsRouter);
router.use("/reports", reportsRouter);
router.use("/ai", aiRouter);

export default router;
