// Deterministic draft templates. Keep these functions small so templates can later be replaced by a model.
import { byId } from '../platforms/registry';

export interface ProjectDraftContext {
  ownerName?: string;
  repoName?: string;
  repoFullName?: string;
  description?: string;
  roles?: string[];
  joinUrl: string;
  mode?: 'referral' | 'screening' | 'direct';
  screeningUrl?: string;
}

export interface PersonalPostOptions {
  extraLine?: string;
  tone?: 'professional' | 'casual';
  includeScreeningLink?: boolean;
}

const clean = (value: unknown, max: number): string =>
  String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);

const projectName = (project: ProjectDraftContext): string => {
  if (project.ownerName && project.repoName) {
    return `${clean(project.ownerName, 39)}/${clean(project.repoName, 100)}`;
  }
  return clean(project.repoFullName || 'project', 140);
};

const roles = (project: ProjectDraftContext): string[] =>
  (Array.isArray(project.roles) ? project.roles : [])
    .map((role) => clean(role, 30))
    .filter(Boolean)
    .slice(0, 5);

const clipped = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;

const joinLink = (project: ProjectDraftContext): string => clean(project.joinUrl, 2000);

export function draftPost(project: ProjectDraftContext, platformId: string): string {
  const platform = byId(platformId);
  if (!platform) throw new Error('Unknown platform.');
  const name = projectName(project);
  const description = clean(project.description, 280);
  const wanted = roles(project);
  const link = joinLink(project);
  const roleLine = wanted.length ? ` Roles wanted: ${wanted.join(', ')}.` : '';

  let text: string;
  if (platformId === 'discord') {
    text = `Hey! ${name} is looking for collaborators.${description ? ` ${description}` : ''}${roleLine} Join: ${link}`;
  } else if (platformId === 'linkedin') {
    text = `We're inviting collaborators to ${name}.${description ? ` ${description}` : ''}${roleLine} If this fits your experience, request to join: ${link} #OpenSource`;
  } else if (platformId === 'bluesky') {
    text = `Join ${name}.${wanted.length ? ` Looking for ${wanted.join(', ')}.` : ''} ${link}`;
  } else {
    text = `${name} is looking for collaborators.${description ? ` ${description}` : ''}${roleLine} Join: ${link}`;
  }

  // The mandatory join link is preserved even when a compact platform needs trimming.
  const prefix = text.replace(link, '').trim();
  return clipped(`${prefix.slice(0, Math.max(0, platform.characterLimit - link.length - 1)).trimEnd()} ${link}`.trim(), platform.characterLimit);
}

export function draftPersonalPost(project: ProjectDraftContext, options: PersonalPostOptions = {}): string {
  const name = projectName(project);
  const description = clean(project.description, 280);
  const wanted = roles(project);
  const extra = clean(options.extraLine, 200);
  const link = joinLink(project);
  const professional = options.tone === 'professional';
  const opening = professional ? `I'm looking for collaborators for ${name}.` : `I'm building ${name} and looking for teammates.`;
  const screening = project.mode === 'screening' ? ' Please finish the screening first, then request to join using the link.' : ' Request to join using the link.';
  const screenLink = options.includeScreeningLink && project.mode === 'screening' && project.screeningUrl ? ` Screening: ${clean(project.screeningUrl, 2000)}` : '';
  const text = `${opening}${description ? ` ${description}` : ''}${wanted.length ? ` Roles wanted: ${wanted.join(', ')}.` : ''}${extra ? ` ${extra}` : ''}${screening}${screenLink} ${link}${professional ? ' #OpenSource' : ''}`;
  return clipped(text, 1000);
}

export default { draftPost, draftPersonalPost };
