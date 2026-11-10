import type { Project } from '@/types/index';

type ListingVisibility = Pick<Project, 'joinMode' | 'isPrivate'>;

export function isDiscoverable(project: ListingVisibility): boolean {
  return project.joinMode !== 'referral' && !project.isPrivate;
}
