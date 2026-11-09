import { getCurrentUser } from './api.js';

export async function renderHeader(container) {
  if (!container) return;

  const user = await getCurrentUser();

  container.innerHTML = `
    <header class="navbar">
      <div class="container nav-container">
        <a href="/" class="brand">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <span>Crewlink</span>
        </a>
        <nav class="nav-actions">
          ${
            user
              ? `
                <a href="/dashboard" class="btn btn-default btn-sm">Dashboard</a>
                <a href="/projects/new" class="btn btn-primary btn-sm">+ New Project</a>
                <div class="user-profile">
                  <img src="${user.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}" alt="${user.login}" class="user-avatar">
                  <span style="font-weight:500;">@${user.login}</span>
                </div>
                <a href="/auth/logout" class="btn btn-secondary btn-sm" title="Sign out">Sign out</a>
              `
              : `
                <a href="/auth/github" class="btn btn-primary btn-sm">Sign in with GitHub</a>
              `
          }
        </nav>
      </div>
    </header>
  `;
}
