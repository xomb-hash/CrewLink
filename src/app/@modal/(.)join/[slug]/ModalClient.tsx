'use client';

import { useRouter } from 'next/navigation';
import { ProjectDetailsModal, type ProjectModalData } from '@/components/ProjectDetailsModal';

export function JoinModalClient({ project }: { project: ProjectModalData }) {
  const router = useRouter();

  return (
    <ProjectDetailsModal
      project={project}
      onClose={() => router.back()}
      hardJoinNavigation
    />
  );
}
