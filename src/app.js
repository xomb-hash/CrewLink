import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import {
  handleLogin,
  handleCallback,
  handleLogout,
  handleCurrentUserApi,
  getCurrentUser
} from './auth/index.js';
import {
  handleGetAdminRepos,
  handleCreateProject,
  handleGetOwnerProjects,
  handleGetProjectById
} from './projects/index.js';
import {
  handleGetJoinData,
  handleApply,
  handleApprove,
  handleReject
} from './applicants/index.js';
import { serveStatic, sendHtml, sendJson, sendError, redirect } from './lib/request.js';
import { storage } from './lib/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

export async function appRouter(req, res) {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // 1. Static asset serving (CSS, client JS, images)
    if (
      pathname.startsWith('/styles/') ||
      pathname.startsWith('/components/') ||
      pathname.startsWith('/features/') ||
      pathname.startsWith('/shared/') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.ico') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.svg')
    ) {
      if (serveStatic(req, res, PUBLIC_DIR)) {
        return;
      }
    }

    // 2. Authentication routes
    if (pathname === '/auth/github' && method === 'GET') {
      return await handleLogin(req, res);
    }
    if (pathname === '/auth/github/callback' && method === 'GET') {
      return await handleCallback(req, res);
    }
    if (pathname === '/auth/logout' && (method === 'GET' || method === 'POST')) {
      return handleLogout(req, res);
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      return handleCurrentUserApi(req, res);
    }

    // 3. Fake GitHub login helper for local dev / testing
    if (pathname === '/auth/fake-github-login' && method === 'GET') {
      const redirectUri = parsedUrl.searchParams.get('redirect_uri') || '/dashboard';
      const state = parsedUrl.searchParams.get('state') || '';
      const loginAs = parsedUrl.searchParams.get('login_as') || 'alice-owner';
      return redirect(res, `${redirectUri}?code=code-${loginAs}&state=${state}`);
    }

    // 4. Page routes (HTML)
    if (pathname === '/' && method === 'GET') {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      return sendHtml(res, 200, html);
    }

    if (pathname === '/dashboard' && method === 'GET') {
      const user = getCurrentUser(req);
      if (!user) {
        return redirect(res, '/auth/github?redirect_to=/dashboard');
      }
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'features', 'dashboard.html'), 'utf8');
      return sendHtml(res, 200, html);
    }

    if (pathname === '/projects/new' && method === 'GET') {
      const user = getCurrentUser(req);
      if (!user) {
        return redirect(res, '/auth/github?redirect_to=/projects/new');
      }
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'features', 'new-project.html'), 'utf8');
      return sendHtml(res, 200, html);
    }

    // Join page: /join/:slug
    const joinMatch = pathname.match(/^\/join\/([a-zA-Z0-9_-]+)\/?$/);
    if (joinMatch && method === 'GET') {
      const slug = joinMatch[1];
      const project = storage.getProjectBySlug(slug);
      if (!project) {
        return sendError(res, 404, 'Join link not found or project has been removed.');
      }
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'features', 'join.html'), 'utf8');
      return sendHtml(res, 200, html);
    }

    // 5. API Routes: Projects
    if (pathname === '/api/repos' && method === 'GET') {
      return await handleGetAdminRepos(req, res);
    }

    if (pathname === '/api/projects' && method === 'POST') {
      return await handleCreateProject(req, res);
    }

    if (pathname === '/api/projects' && method === 'GET') {
      return handleGetOwnerProjects(req, res);
    }

    const projectByIdMatch = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)$/);
    if (projectByIdMatch && method === 'GET') {
      return handleGetProjectById(req, res, projectByIdMatch[1]);
    }

    // 6. API Routes: Applicants & Join flow
    const apiJoinMatch = pathname.match(/^\/api\/join\/([a-zA-Z0-9_-]+)$/);
    if (apiJoinMatch && method === 'GET') {
      return handleGetJoinData(req, res, apiJoinMatch[1]);
    }

    const apiApplyMatch = pathname.match(/^\/api\/join\/([a-zA-Z0-9_-]+)\/apply$/);
    if (apiApplyMatch && method === 'POST') {
      return await handleApply(req, res, apiApplyMatch[1]);
    }

    const approveMatch = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/applicants\/([a-zA-Z0-9_-]+)\/approve$/);
    if (approveMatch && method === 'POST') {
      return await handleApprove(req, res, approveMatch[1], approveMatch[2]);
    }

    const rejectMatch = pathname.match(/^\/api\/projects\/([a-zA-Z0-9_-]+)\/applicants\/([a-zA-Z0-9_-]+)\/reject$/);
    if (rejectMatch && method === 'POST') {
      return await handleReject(req, res, rejectMatch[1], rejectMatch[2]);
    }

    // 7. Not Found
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return sendError(res, 404, 'Endpoint not found');
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>404 - Page Not Found | Crewlink</title>
        <link rel="stylesheet" href="/styles/main.css">
      </head>
      <body>
        <main class="container" style="text-align: center; padding: 4rem 1rem;">
          <h1>404 - Page Not Found</h1>
          <p>The page or join link you were looking for does not exist.</p>
          <a href="/" class="btn btn-primary" style="margin-top: 1rem;">Return Home</a>
        </main>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Unhandled server error:', err);
    if (res.headersSent) return;
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return sendError(res, 500, 'Internal Server Error');
    }
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>500 - Internal Server Error</h1><p>Something went wrong.</p>');
  }
}

export default appRouter;
