import { renderVisibilityIcon } from './visibility-icon.js';
import { renderStatusTag, renderModeTag } from './tag.js';
import { showToast } from './toast.js';
import { createDialog } from './dialog.js';

export function renderProjectCard(project, { onApprove, onReject }) {
  const card = document.createElement('article');
  card.className = 'project-card';
  card.id = `project-${project.id}`;

  const isPublic = !project.isPrivate;
  const repoDisplay = isPublic
    ? `<a href="https://github.com/${project.repoFullName}" target="_blank" rel="noopener noreferrer" class="repo-link" title="Open repository on GitHub">
        ${renderVisibilityIcon(project.isPrivate)}
        <span>${project.repoFullName}</span>
      </a>`
    : `<span class="repo-link">
        ${renderVisibilityIcon(project.isPrivate)}
        <span>${project.repoFullName}</span>
      </span>`;

  const joinUrl = project.shareLinks?.joinUrl || `${window.location.origin}/join/${project.slug}`;

  card.innerHTML = `
    <header class="project-card-header">
      <div class="project-title-area">
        <div class="project-title-row">
          <h2 class="project-title">${project.title}</h2>
          ${renderModeTag(project.joinMode)}
          ${renderVisibilityIcon(project.isPrivate, { showText: true })}
        </div>
        <div>${repoDisplay}</div>
        ${project.description ? `<p class="project-description">${project.description}</p>` : ''}
      </div>
    </header>

    <div class="project-card-toolbar">
      <div class="join-link-box">
        <span style="user-select:all;">${joinUrl}</span>
        <button type="button" class="btn btn-secondary btn-sm copy-link-btn" title="Copy join link">Copy Link</button>
      </div>
      <div class="share-group">
        <span style="font-size: 0.8rem; color: var(--text-muted); margin-right: 0.2rem;">Share:</span>
        <a href="${project.shareLinks?.linkedIn}" target="_blank" rel="noopener noreferrer" class="share-btn">LinkedIn</a>
        <a href="${project.shareLinks?.x}" target="_blank" rel="noopener noreferrer" class="share-btn">X</a>
        <a href="${project.shareLinks?.whatsApp}" target="_blank" rel="noopener noreferrer" class="share-btn">WhatsApp</a>
      </div>
    </div>

    <section class="applicants-section">
      <div class="applicants-header">
        <h3 class="applicants-count">Applicants (${project.applicants?.length || 0})</h3>
      </div>
      <div class="applicant-list">
        <!-- Rendered dynamically -->
      </div>
    </section>
  `;

  // Attach copy link action
  card.querySelector('.copy-link-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      showToast('Join link copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Could not copy automatically. Please copy the URL manually.', 'info');
    });
  });

  const applicantListEl = card.querySelector('.applicant-list');
  const applicants = project.applicants || [];

  if (applicants.length === 0) {
    applicantListEl.innerHTML = `
      <div class="empty-applicants">
        No applicants yet. Share your join link on LinkedIn, X, or WhatsApp to find collaborators!
      </div>
    `;
  } else {
    applicants.forEach((applicant) => {
      const applicantItem = document.createElement('div');
      applicantItem.className = 'applicant-card';
      applicantItem.id = `applicant-${applicant.id}`;

      applicantItem.innerHTML = `
        <div style="flex:1;">
          <div class="applicant-info">
            <img src="${applicant.userAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}" alt="${applicant.userLogin}" class="applicant-avatar">
            <div>
              <div class="applicant-meta-name">
                <a href="https://github.com/${applicant.userLogin}" target="_blank" rel="noopener noreferrer" style="color:var(--text-primary); text-decoration:none;">
                  @${applicant.userLogin}
                </a>
                ${renderStatusTag(applicant.status)}
              </div>
              <div class="applicant-stats">
                <span>Account age: <strong>${applicant.accountAge || 'Unknown'}</strong></span>
                <span>&bull;</span>
                <span>Public repositories: <strong>${applicant.publicRepoCount}</strong></span>
              </div>
            </div>
          </div>
          ${applicant.message ? `<div class="applicant-message">&ldquo;${applicant.message}&rdquo;</div>` : ''}
        </div>
        <div class="applicant-actions">
          ${
            applicant.status === 'pending'
              ? `
                <button type="button" class="btn btn-primary btn-sm btn-approve" data-id="${applicant.id}" data-login="${applicant.userLogin}">Approve</button>
                <button type="button" class="btn btn-danger btn-sm btn-reject" data-id="${applicant.id}" data-login="${applicant.userLogin}">Reject</button>
              `
              : applicant.status === 'approved'
              ? `<span style="font-size:0.8rem; color:var(--success-text);">Invite sent</span>`
              : `<span style="font-size:0.8rem; color:var(--text-muted);">Rejected</span>`
          }
        </div>
      `;

      // Approve button click
      const approveBtn = applicantItem.querySelector('.btn-approve');
      if (approveBtn) {
        approveBtn.addEventListener('click', () => {
          createDialog({
            title: `Approve @${applicant.userLogin}`,
            content: `
              <p>Approving will send a <strong>real GitHub collaborator invitation</strong> to <strong>@${applicant.userLogin}</strong> for repository <code>${project.repoFullName}</code>.</p>
              <p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">
                They will receive an invitation email from GitHub and must accept it on GitHub to access the code.
              </p>
            `,
            confirmText: 'Send GitHub Invitation',
            confirmVariant: 'primary',
            onConfirm: async () => {
              if (onApprove) {
                await onApprove(project.id, applicant.id, applicant.userLogin);
              }
            }
          });
        });
      }

      // Reject button click
      const rejectBtn = applicantItem.querySelector('.btn-reject');
      if (rejectBtn) {
        rejectBtn.addEventListener('click', () => {
          createDialog({
            title: `Reject @${applicant.userLogin}`,
            content: `<p>Are you sure you want to reject the application from <strong>@${applicant.userLogin}</strong>?</p>`,
            confirmText: 'Reject Applicant',
            confirmVariant: 'danger',
            onConfirm: async () => {
              if (onReject) {
                await onReject(project.id, applicant.id, applicant.userLogin);
              }
            }
          });
        });
      }

      applicantListEl.appendChild(applicantItem);
    });
  }

  return card;
}
