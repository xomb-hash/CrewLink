import React from 'react';
import './globals.css';
import { getCurrentUser } from '../lib/auth';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';

export const metadata = {
  title: 'Crewlink — Find Collaborators for GitHub Projects',
  description: 'Where people who share an idea or goal find each other and start building together.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className="dark">
      <body className="bg-[#0d1117] text-[#f0f6fc] min-h-screen flex flex-col antialiased">
        <Navbar user={user} />
        <main className="flex-1 py-8">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
