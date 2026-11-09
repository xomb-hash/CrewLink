import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config/index';

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth';

export interface GitHubUser {
  id: number;
  login: string;
  name?: string;
  avatarUrl: string;
  createdAt: string;
  publicRepos: number;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isPrivate: boolean;
  htmlUrl: string;
  description: string;
  defaultBranch: string;
}

export interface InvitationResult {
  status: 'invited' | 'already_collaborator';
  invitationId?: number;
  htmlUrl?: string;
  message?: string;
}

export class GitHubApi {
  private clientId: string;
  private clientSecret: string;

  constructor(options: { clientId?: string; clientSecret?: string } = {}) {
    this.clientId = options.clientId || config.githubClientId;
    this.clientSecret = options.clientSecret || config.githubClientSecret;
  }

  getOAuthUrl({ redirectUri, state }: { redirectUri: string; state?: string }): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user,repo',
      state: state || '',
    });
    return `${GITHUB_OAUTH_URL}/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken({ code, redirectUri }: { code: string; redirectUri: string }): Promise<string> {
    const response = await fetch(`${GITHUB_OAUTH_URL}/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Crewlink',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
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

  async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    const response = await fetch(`${GITHUB_API_URL}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Crewlink',
      },
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
      publicRepos: user.public_repos || 0,
    };
  }

  async getUserAdminRepos(accessToken: string): Promise<GitHubRepo[]> {
    const response = await fetch(`${GITHUB_API_URL}/user/repos?type=all&per_page=100&sort=updated`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Crewlink',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user repos: HTTP ${response.status}`);
    }

    const repos = await response.json();
    if (!Array.isArray(repos)) {
      return [];
    }

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
        defaultBranch: repo.default_branch,
      }));
  }

  async checkAdminAccess(accessToken: string, owner: string, repo: string): Promise<boolean> {
    try {
      const response = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Crewlink',
        },
      });
      if (!response.ok) return false;
      const data = await response.json();
      return Boolean(data.permissions && data.permissions.admin);
    } catch {
      return false;
    }
  }

  private getAppJwt(): string | null {
    const appId = config.githubAppId;
    const keyPath = config.githubPrivateKeyPath;
    if (!appId || !keyPath) return null;

    try {
      if (!fs.existsSync(keyPath)) return null;
      const privateKey = fs.readFileSync(keyPath, 'utf8');
      const now = Math.floor(Date.now() / 1000);
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const header = b64({ alg: 'RS256', typ: 'JWT' });
      const payload = b64({ iat: now - 60, exp: now + 540, iss: appId });
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(`${header}.${payload}`);
      const signature = sign.sign(privateKey, 'base64url');
      return `${header}.${payload}.${signature}`;
    } catch {
      return null;
    }
  }

  async getInstallationToken(owner: string, repo: string): Promise<{ token?: string; error?: string }> {
    const jwt = this.getAppJwt();
    if (!jwt) return {};

    try {
      const instRes = await fetch(`${GITHUB_API_URL}/repos/${owner}/${repo}/installation`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Crewlink',
        },
      });

      if (instRes.status === 404) {
        return {
          error: `The Crewlink GitHub App isn't installed on this repository. Please install it on ${owner}/${repo}, then try again.`,
        };
      }

      if (!instRes.ok) {
        return {
          error: `Failed to verify GitHub App installation on ${owner}/${repo}: HTTP ${instRes.status}`,
        };
      }

      const inst = await instRes.json();
      const tokRes = await fetch(`${GITHUB_API_URL}/app/installations/${inst.id}/access_tokens`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Crewlink',
        },
      });

      if (!tokRes.ok) {
        return { error: `Couldn't obtain installation token from GitHub (HTTP ${tokRes.status}).` };
      }

      const tokData = await tokRes.json();
      return { token: tokData.token };
    } catch (err: unknown) {
      return { error: `Network error connecting to GitHub: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async inviteCollaborator({
    accessToken,
    owner,
    repo,
    username,
    permission = 'pull',
  }: {
    accessToken: string;
    owner: string;
    repo: string;
    username: string;
    permission?: string;
  }): Promise<InvitationResult> {
    // If a GitHub App is configured with a valid private key, use installation token with 'pull' (read-only)
    let authHeader = `Bearer ${accessToken}`;

    const appTokenResult = await this.getInstallationToken(owner, repo);
    if (appTokenResult.error) {
      throw new Error(appTokenResult.error);
    }
    if (appTokenResult.token) {
      authHeader = `token ${appTokenResult.token}`;
    }

    const response = await fetch(
      `${GITHUB_API_URL}/repos/${owner}/${repo}/collaborators/${encodeURIComponent(username)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Crewlink',
        },
        body: JSON.stringify({ permission }),
      }
    );

    if (response.status === 201) {
      const data = await response.json();
      return {
        status: 'invited',
        invitationId: data.id,
        htmlUrl: data.html_url,
      };
    }

    if (response.status === 204) {
      return {
        status: 'already_collaborator',
        message: `${username} is already a collaborator`,
      };
    }

    if (response.status === 404) {
      throw new Error(`GitHub couldn't find user ${username}.`);
    }

    if (response.status === 403) {
      throw new Error('GitHub refused invitation. Check repository administration permissions.');
    }

    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `GitHub invitation failed: HTTP ${response.status} - ${errorData.message || response.statusText}`
    );
  }
}

export const githubApi = new GitHubApi();
export default githubApi;
