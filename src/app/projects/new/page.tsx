import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { NewProjectClient } from './NewProjectClient';

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/github?redirect_to=/projects/new');
  }

  return <NewProjectClient />;
}
