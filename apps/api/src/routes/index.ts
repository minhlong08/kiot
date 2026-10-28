import type { RoutePlugin } from '../app';
import { authRoutes } from './auth';
import { branchRoutes } from './branches';
import { roleRoutes } from './roles';
import { userRoutes } from './users';
import { settingsRoutes } from './settings';
import { auditLogRoutes } from './auditLogs';
import { catalogRoutes } from './catalog';
import { productRoutes } from './products';
import { priceBookRoutes } from './priceBooks';
import { fileRoutes } from './files';
import { supplierRoutes } from './suppliers';
import { purchaseOrderRoutes, purchaseReturnRoutes, receiptRoutes } from './purchasing';
import { incomingInvoiceRoutes, servicePurchaseRoutes } from './purchaseExtras';
import { customerRoutes } from './customers';
import { promotionRoutes } from './promotions';
import { stockIssueRoutes, stockTakeRoutes, transferRoutes } from './stockDocs';

export const routes: RoutePlugin[] = [authRoutes, branchRoutes, roleRoutes, userRoutes, settingsRoutes, auditLogRoutes, catalogRoutes, productRoutes, stockTakeRoutes, stockIssueRoutes, transferRoutes, priceBookRoutes, fileRoutes, supplierRoutes, purchaseOrderRoutes, receiptRoutes, purchaseReturnRoutes, incomingInvoiceRoutes, servicePurchaseRoutes, customerRoutes, promotionRoutes];
