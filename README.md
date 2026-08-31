# Nexus Backend

Express.js + Prisma + PostgreSQL backend for the Nexus Inventory & Sales Management System.

> **⚠️ Upgraded to true multi-tenant SaaS.** This version adds an `Organization` model that every
> row now belongs to, switches auth from a `localStorage` JWT to an httpOnly cookie + CSRF token,
> and adds Socket.io + email delivery for low-stock alerts. If you're upgrading an existing
> database rather than starting fresh, **this is a breaking schema change** — see
> [MIGRATION.md](./MIGRATION.md) before running anything below. If you're starting from a fresh
> database, just follow Quick Start as normal; `npm run db:push` (or a fresh migration) will create
> the new schema directly and `npm run db:seed` will create the demo Organization + Admin.

## Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js v4
- **ORM**: Prisma v5
- **Database**: PostgreSQL
- **Auth**: JWT in an httpOnly cookie (jsonwebtoken) + bcryptjs + CSRF double-submit cookie
- **Realtime**: Socket.io (org-scoped rooms, currently used for low-stock push notifications)
- **Email**: Resend (verification, password reset, team invites, low-stock alerts)
- **AI**: Groq API (optional) — every tool call is scoped to the caller's own organization

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL` — your PostgreSQL connection string
- `JWT_SECRET` — run `openssl rand -hex 32` for a secure secret
- `GROQ_API_KEY` — optional, for AI assistant feature

### 3. Set up the database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to DB (dev) — creates tables
npm run db:push

# Or use migrations (recommended for production)
npm run db:migrate
```

### 4. Seed sample data (optional)

```bash
npm run db:seed
```

This creates:
- Admin user: `admin@nexus.com` / `password123`
- Sample categories, products, customers, suppliers, warehouse

### 5. Run the server

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

Server starts at `http://localhost:8080`

---

## API Endpoints

All endpoints except `/api/auth/register`, `/api/auth/login`, and `/api/healthz` require:
```
Authorization: Bearer <token>
```

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET  | `/api/auth/me` | Get current user |
| POST | `/api/auth/logout` | Logout (client-side) |

### Products
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/products` | List products (search, categoryId, status) |
| POST   | `/api/products` | Create product |
| GET    | `/api/products/:id` | Get product with inventory |
| PATCH  | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/categories` | List categories |
| POST   | `/api/categories` | Create category |
| GET    | `/api/categories/:id` | Get category |
| PATCH  | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |

### Warehouses
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/warehouses` | List warehouses |
| POST   | `/api/warehouses` | Create warehouse |
| GET    | `/api/warehouses/:id` | Get warehouse |
| PATCH  | `/api/warehouses/:id` | Update warehouse |
| DELETE | `/api/warehouses/:id` | Delete warehouse |

### Inventory
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/inventory` | List inventory (warehouseId, productId) |
| POST   | `/api/inventory/adjust` | Adjust stock levels |
| POST   | `/api/inventory/transfer` | Transfer stock between warehouses |
| GET    | `/api/inventory/transactions` | List transactions |

### Customers
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/customers` | List customers (search) |
| POST   | `/api/customers` | Create customer |
| GET    | `/api/customers/:id` | Get customer with orders |
| PATCH  | `/api/customers/:id` | Update customer |
| DELETE | `/api/customers/:id` | Delete customer |

### Suppliers
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/suppliers` | List suppliers (search) |
| POST   | `/api/suppliers` | Create supplier |
| GET    | `/api/suppliers/:id` | Get supplier |
| PATCH  | `/api/suppliers/:id` | Update supplier |
| DELETE | `/api/suppliers/:id` | Delete supplier |

### Sales Orders
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/sales/summary/stats` | Sales statistics |
| GET    | `/api/sales` | List sales orders (status, customerId) |
| POST   | `/api/sales` | Create sales order |
| GET    | `/api/sales/:id` | Get sales order with items |
| PATCH  | `/api/sales/:id` | Update status/notes |
| DELETE | `/api/sales/:id` | Delete sales order |

### Purchase Orders
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/purchases` | List purchase orders (status, supplierId) |
| POST   | `/api/purchases` | Create purchase order |
| GET    | `/api/purchases/:id` | Get purchase order with items |
| PATCH  | `/api/purchases/:id` | Update (PATCH with `status: "received"` auto-updates inventory) |
| DELETE | `/api/purchases/:id` | Delete purchase order |

### Invoices
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/invoices` | List invoices (status, customerId) |
| POST   | `/api/invoices` | Create invoice |
| GET    | `/api/invoices/:id` | Get invoice |
| PATCH  | `/api/invoices/:id` | Update (PATCH with `status: "paid"` auto-sets paidAt) |
| DELETE | `/api/invoices/:id` | Delete invoice |

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/summary` | KPI summary |
| GET | `/api/dashboard/revenue-chart` | 12-month revenue chart |
| GET | `/api/dashboard/top-products` | Top 10 products by revenue |
| GET | `/api/dashboard/recent-activity` | Recent inventory + order activity |
| GET | `/api/dashboard/low-stock` | Low stock items |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/inventory` | Inventory report by category |
| GET | `/api/reports/sales` | Sales report + top customers |
| GET | `/api/reports/profit-loss` | 12-month P&L report |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/notifications` | List notifications (unread=true) |
| PATCH  | `/api/notifications/:id/read` | Mark as read |
| POST   | `/api/notifications/mark-all-read` | Mark all read |
| DELETE | `/api/notifications/:id` | Delete notification |

### AI Assistant
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai/chat` | Chat with AI (requires GROQ_API_KEY) |

**Body:** `{ messages: [{ role: "user", content: "..." }] }`

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Health check + DB status |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing secret (min 32 chars) |
| `PORT` | ❌ | Server port (default: 8080) |
| `GROQ_API_KEY` | ❌ | Groq API key for AI features |
| `FRONTEND_URL` | ❌ | CORS allowed origin (default: *) |
| `NODE_ENV` | ❌ | `development` or `production` |

## Connecting the Next.js Frontend

Set the base URL in your Next.js `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8080
```

Then call APIs as:
```ts
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/products`, {
  headers: { Authorization: `Bearer ${token}` }
});
```
