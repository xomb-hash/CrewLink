import { renderHeader } from '../shared/header.js';
import { renderFooter } from '../shared/footer.js';
import { apiRequest } from '../shared/api.js';
import { showToast } from '../components/toast.js';
import { setupRadioCards } from '../components/form.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader(document.getElementById('header-container'));
  renderFooter(document.getElementById('footer-container'));

  const loadingEl = document.getElementById('loading-repos');
  const formEl = document.getElementById('create-project-form');
  const repoSelect = document.getElementById('repo-select');
  const titleInput = document.getElementById('title');
  const descriptionInput = document.getElementById('description');
  const screeningGroup = document.getElementById('screening-url-group');
  const screeningInput = document.getElementById('screening-url');
  const submitBtn = document.getElementById('submit-btn');

  setupRadioCards(document.getElementById('mode-selector'));

  let availableRepos = [];

  // Toggle screening URL visibility
  document.querySelectorAll('input[name="joinMode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'screening') {
        screeningGroup.style.display = 'block';
        screeningInput.setAttribute('required', 'true');
      } else {
        screeningGroup.style.display = 'none';
        screeningInput.removeAttribute('required');
      }
    });
  });

  // Load admin repositories
  try {
    const data = await apiRequest('/api/repos');
    availableRepos = data.repos || [];

    loadingEl.style.display = 'none';
    formEl.style.display = 'block';

    if (availableRepos.length === 0) {
      repoSelect.innerHTML = '<option value="" disabled selected>No repositories found where you have admin permissions</option>';
      submitBtn.disabled = true;
      return;
    }

    repoSelect.innerHTML = '<option value="" disabled selected>Select a repository...</option>' +
      availableRepos.map((repo) => {
        const lock = repo.isPrivate ? '🔒 Private' : '🌐 Public';
        return `<option value="${repo.fullName}" data-private="${repo.isPrivate}">${repo.fullName} (${lock})</option>`;
      }).join('');
  } catch (err) {
    loadingEl.innerHTML = `
      <div style="color: #f85149; margin-bottom: 0.5rem;">Could not load repositories: ${err.message}</div>
      <a href="/auth/github" class="btn btn-secondary btn-sm">Re-authenticate with GitHub</a>
    `;
    return;
  }

  // Pre-fill title when repository is picked
  repoSelect.addEventListener('change', () => {
    const selected = availableRepos.find((r) => r.fullName === repoSelect.value);
    if (selected && !titleInput.value) {
      titleInput.value = selected.name;
    }
    if (selected && selected.description && !descriptionInput.value) {
      descriptionInput.value = selected.description;
    }
  });

  // Form submission
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedFullName = repoSelect.value;
    const selectedRepo = availableRepos.find((r) => r.fullName === selectedFullName);
    if (!selectedRepo) {
      showToast('Please select a valid repository', 'error');
      return;
    }

    const joinMode = document.querySelector('input[name="joinMode"]:checked').value;
    const screeningUrl = screeningInput.value.trim();

    if (joinMode === 'screening' && !screeningUrl) {
      showToast('Please provide your screening link', 'error');
      screeningInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Connecting...';

    try {
      await apiRequest('/api/projects', {
        method: 'POST',
        body: {
          repoFullName: selectedRepo.fullName,
          isPrivate: selectedRepo.isPrivate,
          joinMode,
          screeningUrl: joinMode === 'screening' ? screeningUrl : '',
          title: titleInput.value.trim() || selectedRepo.name,
          description: descriptionInput.value.trim()
        }
      });

      showToast('Project created successfully!', 'success');
      window.location.href = '/dashboard';
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Project & Get Join Link';
      showToast(err.message || 'Failed to create project', 'error');
    }
  });
});
