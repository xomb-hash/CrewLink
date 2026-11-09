export class FakeGitHubApi {
  constructor() {
    this.users = new Map();
    this.tokens = new Map();
    this.repos = new Map(); // key: owner/repo
    this.invitations = []; // record of all invitations sent
    this.initDefaults();
  }

  initDefaults() {
    // Default mock user (owner)
    this.addUser({
      id: 101,
      login: 'alice-owner',
      name: 'Alice Owner',
      avatarUrl: 'https://avatars.githubusercontent.com/u/101',
      createdAt: '2022-01-15T00:00:00Z',
      publicRepos: 14,
      token: 'fake-token-alice'
    });

    // Default mock user (applicant)
    this.addUser({
      id: 202,
      login: 'bob-builder',
      name: 'Bob Builder',
      avatarUrl: 'https://avatars.githubusercontent.com/u/202',
      createdAt: '2023-06-20T00:00:00Z',
      publicRepos: 5,
      token: 'fake-token-bob'
    });

    // Default mock repo
    this.addRepo({
      id: 501,
      name: 'rocket-ship',
      fullName: 'alice-owner/rocket-ship',
      owner: 'alice-owner',
      isPrivate: false,
      htmlUrl: 'https://github.com/alice-owner/rocket-ship',
      description: 'A shared open-source project',
      defaultBranch: 'main',
      admins: ['alice-owner']
    });

    // Default private repo
    this.addRepo({
      id: 502,
      name: 'secret-engine',
      fullName: 'alice-owner/secret-engine',
      owner: 'alice-owner',
      isPrivate: true,
      htmlUrl: 'https://github.com/alice-owner/secret-engine',
      description: 'Internal engine code',
      defaultBranch: 'main',
      admins: ['alice-owner']
    });
  }

  reset() {
    this.users.clear();
    this.tokens.clear();
    this.repos.clear();
    this.invitations = [];
    this.initDefaults();
  }

  addUser(user) {
    const userData = {
      id: user.id,
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatarUrl || `https://avatars.githubusercontent.com/u/${user.id}`,
      createdAt: user.createdAt || new Date().toISOString(),
      publicRepos: user.publicRepos || 0
    };
    this.users.set(user.login, userData);
    const token = user.token || `fake-token-${user.login}`;
    this.tokens.set(token, userData);
    return { user: userData, token };
  }

  addRepo(repo) {
    const repoData = {
      id: repo.id || Math.floor(Math.random() * 10000),
      name: repo.name,
      fullName: repo.fullName || `${repo.owner}/${repo.name}`,
      owner: repo.owner,
      isPrivate: Boolean(repo.isPrivate),
      htmlUrl: repo.htmlUrl || `https://github.com/${repo.owner}/${repo.name}`,
      description: repo.description || '',
      defaultBranch: repo.defaultBranch || 'main',
      admins: repo.admins || [repo.owner]
    };
    this.repos.set(repoData.fullName.toLowerCase(), repoData);
    return repoData;
  }

  getOAuthUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      mock_oauth: 'true',
      redirect_uri: redirectUri,
      state: state || ''
    });
    return `/auth/fake-github-login?${params.toString()}`;
  }

  async exchangeCodeForToken({ code }) {
    // If code is "code-alice" or "code-bob", map to token
    if (code.startsWith('code-')) {
      const login = code.replace('code-', '');
      const user = this.users.get(login);
      if (user) return `fake-token-${login}`;
    }
    // Default fallback
    return code || 'fake-token-alice';
  }

  async getAuthenticatedUser(accessToken) {
    const user = this.tokens.get(accessToken);
    if (!user) {
      // Create on the fly if test passed custom token
      const login = accessToken.replace('fake-token-', '') || 'test-user';
      return {
        id: 999,
        login,
        name: login,
        avatarUrl: `https://avatars.githubusercontent.com/u/999`,
        createdAt: '2023-01-01T00:00:00Z',
        publicRepos: 3
      };
    }
    return { ...user };
  }

  async getUserAdminRepos(accessToken) {
    const user = await this.getAuthenticatedUser(accessToken);
    const result = [];
    for (const repo of this.repos.values()) {
      if (repo.admins.includes(user.login)) {
        result.push({
          id: repo.id,
          name: repo.name,
          fullName: repo.fullName,
          owner: repo.owner,
          isPrivate: repo.isPrivate,
          htmlUrl: repo.htmlUrl,
          description: repo.description,
          defaultBranch: repo.defaultBranch
        });
      }
    }
    return result;
  }

  async checkAdminAccess(accessToken, owner, repo) {
    const user = await this.getAuthenticatedUser(accessToken);
    const key = `${owner}/${repo}`.toLowerCase();
    const repoData = this.repos.get(key);
    if (!repoData) return false;
    return repoData.admins.includes(user.login);
  }

  async inviteCollaborator({ accessToken, owner, repo, username, permission = 'push' }) {
    const inviter = await this.getAuthenticatedUser(accessToken);
    const key = `${owner}/${repo}`.toLowerCase();
    const repoData = this.repos.get(key);

    if (!repoData) {
      throw new Error(`Repository ${owner}/${repo} not found`);
    }

    if (!repoData.admins.includes(inviter.login)) {
      throw new Error(`User ${inviter.login} does not have admin permissions on ${repoData.fullName}`);
    }

    const invitation = {
      id: this.invitations.length + 1,
      owner,
      repo,
      username,
      permission,
      invitedBy: inviter.login,
      sentAt: new Date().toISOString()
    };

    this.invitations.push(invitation);

    return {
      status: 'invited',
      invitationId: invitation.id,
      htmlUrl: `https://github.com/${owner}/${repo}/invitations`
    };
  }
}

export const fakeGitHub = new FakeGitHubApi();
