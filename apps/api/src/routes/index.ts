import type { RoutePlugin } from '../app';
import { authRoutes } from './auth';
import { branchRoutes } from './branches';
import { roleRoutes } from './roles';
import { userRoutes } from './users';
import { settingsRoutes } from './settings';
import { auditLogRoutes } from './auditLogs';
import { catalogRoutes } from './catalog';

export const routes: RoutePlugin[] = [authRoutes, branchRoutes, roleRoutes, userRoutes, settingsRoutes, auditLogRoutes, catalogRoutes];
