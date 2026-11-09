import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { ApplicationsClient } from './ApplicationsClient';
import type { UserApplication } from '@/types/index';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My Applications | Crewlink',
  description: 'Track the status of your join requests to GitHub repositories.',
};

export default async function ApplicationsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/github?redirect_to=/applications');
  }

  let applications: UserApplication[] = [];
  try {
    applications = await storage.getApplicationsByUserId(user.id);
  } catch {
    applications = [];
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <ApplicationsClient applications={applications} user={user} />
    </div>
  );
}
