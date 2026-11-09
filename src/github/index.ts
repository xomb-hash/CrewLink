import { githubApi, GitHubApi } from './api';
import { fakeGitHub, FakeGitHubApi } from './fake';

let activeClient: GitHubApi | FakeGitHubApi =
  process.env.NODE_ENV === 'test' ? fakeGitHub : githubApi;

export function getGitHubClient(): GitHubApi | FakeGitHubApi {
  return activeClient;
}

export function setGitHubClient(client: GitHubApi | FakeGitHubApi): void {
  activeClient = client;
}

export { githubApi, fakeGitHub };
export default getGitHubClient;
