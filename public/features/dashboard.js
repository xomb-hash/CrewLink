import { renderHeader } from '../shared/header.js';
import { renderFooter } from '../shared/footer.js';
import { apiRequest } from '../shared/api.js';
import { renderProjectCard } from '../components/project-card.js';
import { showToast } from '../components/toast.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader(document.getElementById('header-container'));
  renderFooter(document.getElementById('footer-container'));

  const loadingEl = document.getElementById('loading-projects');
  const emptyEl = document.getElementById('empty-projects');
  const containerEl = document.getElementById('projects-container');

  async function loadProjects() {
    try {
      const data = await apiRequest('/api/projects');
      const projects = data.projects || [];

      loadingEl.style.display = 'none';

      if (projects.length === 0) {
        emptyEl.style.display = 'block';
        containerEl.innerHTML = '';
        return;
      }

      emptyEl.style.display = 'none';
      containerEl.innerHTML = '';

      projects.forEach((project) => {
        const card = renderProjectCard(project, {
          onApprove: async (projectId, applicantId, login) => {
            try {
              const res = await apiRequest(`/api/projects/${projectId}/applicants/${applicantId}/approve`, {
                method: 'POST'
              });
              showToast(`Invitation sent to @${login}! They must accept on GitHub.`, 'success');
              await loadProjects();
            } catch (err) {
              showToast(err.message || 'Failed to approve applicant', 'error');
            }
          },
          onReject: async (projectId, applicantId, login) => {
            try {
              await apiRequest(`/api/projects/${projectId}/applicants/${applicantId}/reject`, {
                method: 'POST'
              });
              showToast(`Application from @${login} rejected.`, 'info');
              await loadProjects();
            } catch (err) {
              showToast(err.message || 'Failed to reject applicant', 'error');
            }
          }
        });
        containerEl.appendChild(card);
      });
    } catch (err) {
      loadingEl.innerHTML = `
        <div style="color: #f85149; margin-bottom: 0.5rem;">Could not load projects: ${err.message}</div>
        <a href="/auth/github" class="btn btn-secondary btn-sm">Sign in again</a>
      `;
    }
  }

  await loadProjects();
});
