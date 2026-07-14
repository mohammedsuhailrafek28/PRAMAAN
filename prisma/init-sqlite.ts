import { reconcilePrismaMigrations } from "../scripts/reconcile-prisma-migrations.js";

reconcilePrismaMigrations({ deploy: true, status: false });
