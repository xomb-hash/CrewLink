import { renderHeader } from '../shared/header.js';
import { renderFooter } from '../shared/footer.js';
import { apiRequest } from '../shared/api.js';
import { renderVisibilityIcon } from '../components/visibility-icon.js';
import { renderStatusTag, renderModeTag } from '../components/tag.js';
import { showToast } from '../components/toast.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader(document.getElementById('header-container'));
  renderFooter(document.getElementById('footer-container'));

  const pathname = window.location.pathname;
  const match = pathname.match(/\/join\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    document.getElementById('loading').innerHTML = '<div style="color:#f85149;">Invalid join link.</div>';
    return;
  }
  const slug = match[1];

  const loadingEl = document.getElementById('loading');
  const projectContainer = document.getElementById('project-container');
  const titleEl = document.getElementById('project-title');
  const descEl = document.getElementById('project-description');
  const repoContainer = document.getElementById('repo-link-container');
  const modeTagEl = document.getElementById('project-mode-tag');
  const visibilityBadgeEl = document.getElementById('project-visibility-badge');
  const ownerAvatar = document.getElementById('owner-avatar');
  const ownerLink = document.getElementById('owner-link');

  const screeningSection = document.getElementById('screening-section');
  const screeningBtn = document.getElementById('screening-link-btn');

  const ownerNotice = document.getElementById('owner-notice');
  const existingAppBox = document.getElementById('existing-application-box');
  const notSignedInBox = document.getElementById('not-signed-in');
  const signinBtn = document.getElementById('github-signin-btn');
  const applyForm = document.getElementById('apply-form');
  const userLoginEl = document.getElementById('current-user-login');
  const applyMessage = document.getElementById('apply-message');
  const submitApplyBtn = document.getElementById('submit-apply-btn');

  async function loadJoinData() {
    try {
      const data = await apiRequest(`/api/join/${slug}`);
      const project = data.project;
      const currentUser = data.currentUser;
      const isOwner = data.isOwner;
      const existing = data.existingApplication;

      loadingEl.style.display = 'none';
      projectContainer.style.display = 'block';

      titleEl.textContent = project.title;
      descEl.textContent = project.description || 'No description provided.';
      modeTagEl.innerHTML = renderModeTag(project.joinMode);
      visibilityBadgeEl.innerHTML = renderVisibilityIcon(project.isPrivate, { showText: true });

      // Repo link rendering (spec: clicking a public project opens its code on GitHub)
      if (!project.isPrivate && project.githubUrl) {
        repoContainer.innerHTML = `
          <a href="${project.githubUrl}" target="_blank" rel="noopener noreferrer" class="repo-link" style="font-size:0.95rem;">
            ${renderVisibilityIcon(false)}
            <span>${project.repoFullName}</span>
            <span style="font-size:0.75rem; color:var(--info-text);">&nearr; View code on GitHub</span>
          </a>
        `;
      } else {
        repoContainer.innerHTML = `
          <span class="repo-link" style="font-size:0.95rem;">
            ${renderVisibilityIcon(true)}
            <span>${project.repoFullName}</span>
          </span>
        `;
      }

      ownerAvatar.src = project.ownerAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
      ownerLink.href = `https://github.com/${project.ownerLogin}`;
      ownerLink.textContent = `@${project.ownerLogin}`;

      // Screening section
      if (project.joinMode === 'screening' && project.screeningUrl) {
        screeningSection.style.display = 'block';
        screeningBtn.href = project.screeningUrl;
      } else {
        screeningSection.style.display = 'none';
      }

      // Application State
      if (isOwner) {
        ownerNotice.style.display = 'block';
        existingAppBox.style.display = 'none';
        notSignedInBox.style.display = 'none';
        applyForm.style.display = 'none';
      } else if (existing) {
        ownerNotice.style.display = 'none';
        existingAppBox.style.display = 'block';
        notSignedInBox.style.display = 'none';
        applyForm.style.display = 'none';

        const tagContainer = document.getElementById('status-tag-container');
        const explanationEl = document.getElementById('status-explanation');

        tagContainer.innerHTML = renderStatusTag(existing.status);

        if (existing.status === 'approved') {
          explanationEl.innerHTML = `
            <strong>Your request has been approved!</strong><br>
            A GitHub collaborator invitation was dispatched. Please check your GitHub email or the repository page to accept the invitation and start contributing.
          `;
        } else if (existing.status === 'rejected') {
          explanationEl.textContent = 'The project owner has reviewed and declined this request.';
        } else {
          explanationEl.textContent = 'Your request has been submitted and is currently pending review by the project owner.';
        }
      } else if (!currentUser) {
        ownerNotice.style.display = 'none';
        existingAppBox.style.display = 'none';
        notSignedInBox.style.display = 'block';
        applyForm.style.display = 'none';
        signinBtn.href = `/auth/github?redirect_to=${encodeURIComponent(pathname)}`;
      } else {
        // Signed in, hasn't applied
        ownerNotice.style.display = 'none';
        existingAppBox.style.display = 'none';
        notSignedInBox.style.display = 'none';
        applyForm.style.display = 'block';
        userLoginEl.textContent = `@${currentUser.login}`;
      }
    } catch (err) {
      loadingEl.innerHTML = `<div style="color:#f85149;">Could not load join page: ${err.message}</div>`;
    }
  }

  // Handle application submission
  applyForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    submitApplyBtn.disabled = true;
    submitApplyBtn.textContent = 'Submitting request...';

    try {
      await apiRequest(`/api/join/${slug}/apply`, {
        method: 'POST',
        body: {
          message: applyMessage.value.trim()
        }
      });

      showToast('Join request submitted successfully!', 'success');
      await loadJoinData();
    } catch (err) {
      submitApplyBtn.disabled = false;
      submitApplyBtn.textContent = 'Request to Join Project';
      showToast(err.message || 'Failed to submit application', 'error');
    }
  });

  await loadJoinData();
});
