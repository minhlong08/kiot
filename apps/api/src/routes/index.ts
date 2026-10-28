import type { RoutePlugin } from '../app';
import { authRoutes } from './auth';

export const routes: RoutePlugin[] = [authRoutes];
