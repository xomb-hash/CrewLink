import type { Project } from '../types/index';

export function projectLogoUrl(project: Pick<Project, 'id' | 'logoPath'>): string | null {
  return project.logoPath ? `/api/projects/${project.id}/logo` : null;
}
