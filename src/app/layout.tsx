import React from 'react';
import './globals.css';
import { getCurrentUser } from '../lib/auth';
import { AppShell } from '../components/AppShell';

export const metadata = {
  title: 'Crewlink — Find Collaborators for GitHub Projects',
  description: 'Where people who share an idea or goal find each other and start building together.',
};

export default async function RootLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Only send non-sensitive fields to the client; the access token never leaves the server.
  const shellUser = user
    ? {
        id: String(user.id),
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
      }
    : null;

  return (
    <html lang="en" className="dark">
      <body>
        <AppShell user={shellUser}>{children}</AppShell>
        {modal}
      </body>
    </html>
  );
}
