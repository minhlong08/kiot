import { useEffect } from 'react';
import { createRootRoute, createRoute, createRouter, Navigate, Outlet, useNavigate } from '@tanstack/react-router';
import { AppShell } from './layout/AppShell';
import { NAV_PATHS } from './layout/nav';
import { LoginPage } from './pages/LoginPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { PAGES } from './pages/registry';
import { useAuth } from './lib/auth';
import { setAuthErrorHandler } from './lib/api';
import { t } from './lib/i18n';
import { ShopLayout } from './pages/shop/ShopLayout';
import { ShopHome } from './pages/shop/ShopHome';
import { ShopProduct } from './pages/shop/ShopProduct';
import { ShopCheckout } from './pages/shop/ShopCheckout';

function Authed() {
  const { me, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    setAuthErrorHandler(code => navigate({ to: code === 'PASSWORD_CHANGE_REQUIRED' ? '/change-password' : '/login' }));
  }, [navigate]);
  if (loading) return <div className="p-6 text-slate-500">{t('common.loading')}</div>;
  if (!me) return <Navigate to="/login" />;
  if (me.user.mustChangePassword) return <Navigate to="/change-password" />;
  return <AppShell><Outlet /></AppShell>;
}

const rootRoute = createRootRoute({ component: Outlet });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const changePasswordRoute = createRoute({ getParentRoute: () => rootRoute, path: '/change-password', component: ChangePasswordPage });
// Public storefront: no session, own layout.
const shopRoute = createRoute({ getParentRoute: () => rootRoute, path: '/shop', component: ShopLayout });
const shopRoutes = [
  createRoute({ getParentRoute: () => shopRoute, path: '/', component: ShopHome }),
  createRoute({ getParentRoute: () => shopRoute, path: '/p/$id', component: ShopProduct }),
  createRoute({ getParentRoute: () => shopRoute, path: '/cart', component: ShopCheckout }),
];
const authedRoute = createRoute({ getParentRoute: () => rootRoute, id: 'authed', component: Authed });
const indexRoute = createRoute({ getParentRoute: () => authedRoute, path: '/', component: () => <Navigate to="/dashboard" /> });

const paths = [...new Set([...NAV_PATHS, ...Object.keys(PAGES)])];
const pageRoutes = paths.map(path => createRoute({ getParentRoute: () => authedRoute, path, component: PAGES[path] ?? ComingSoonPage }));
const notFoundRoute = createRoute({ getParentRoute: () => authedRoute, path: '$', component: ComingSoonPage });

const routeTree = rootRoute.addChildren([loginRoute, changePasswordRoute, shopRoute.addChildren(shopRoutes), authedRoute.addChildren([indexRoute, ...pageRoutes, notFoundRoute])]);

export const router = createRouter({ routeTree, defaultPreload: false });
