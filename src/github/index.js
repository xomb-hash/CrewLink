import { githubApi } from './api.js';
import { fakeGitHub } from './fake.js';

let activeClient = process.env.NODE_ENV === 'test' ? fakeGitHub : githubApi;

export function getGitHubClient() {
  return activeClient;
}

export function setGitHubClient(client) {
  activeClient = client;
}

export { githubApi, fakeGitHub };
export default getGitHubClient;
