import { config } from '../config/index.js';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth';

export class GitHubApi {
  constructor(options = {}) {
    this.clientId = options.clientId || config.githubClientId;
    this.clientSecret = options.clientSecret || config.githubClientSecret;
  }

  getOAuthUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user,repo',
      state: state || ''
    });
    return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken({ code, redirectUri }) {
    const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Crewlink'
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri
      })
    });

    if (!response.ok) {
      throw new Error(`GitHub token exchange failed: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    }

    return data.access_token;
  }

  async getAuthenticatedUser(accessToken) {
    const response = await fetch(`${GITHUB_API_URL}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Crewlink'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user: HTTP ${response.status}`);
    }

    const user = await response.json();
    return {
      id: user.id,
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
      publicRepos: user.public_repos || 0
    };
  }

  async getUserAdminRepos(accessToken) {
    const response = await fetch(`${GITHUB_API_URL}/user/repos?type=all&per_page=100&sort=updated`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Crewlink'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user repos: HTTP ${response.status}`);
    }

    const repos = await response.json();
    if (!Array.isArray(repos)) {
      return [];
    }

    // Filter to repositories where the user has admin access
    return repos
      .filter((repo) => repo.permissions && repo.permissions.admin)
      .map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        isPrivate: repo.private,
        htmlUrl: repo.html_url,
        description: repo.description || '',
        defaultBranch: repo.default_branch
      }));
  }

  async checkAdminAccess(accessToken, owner, repo) {
    try {
      const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Crewlink'
        }
      });
      if (!response.ok) return false;
      const data = await response.json();
      return Boolean(data.permissions && data.permissions.admin);
    } catch {
      return false;
    }
  }

  async inviteCollaborator({ accessToken, owner, repo, username, permission = 'push' }) {
    const response = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Crewlink'
        },
        body: JSON.stringify({ permission })
      }
    );

    // 201 Created: invitation created
    // 204 No Content: user is already a collaborator
    if (response.status === 201) {
      const data = await response.json();
      return {
        status: 'invited',
        invitationId: data.id,
        htmlUrl: data.html_url
      };
    }

    if (response.status === 204) {
      return {
        status: 'already_collaborator',
        message: `${username} is already a collaborator`
      };
    }

    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `GitHub invitation failed: HTTP ${response.status} - ${errorData.message || response.statusText}`
    );
  }
}

export const githubApi = new GitHubApi();
export default githubApi;
