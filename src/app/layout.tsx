import React from 'react';
import './globals.css';
import { getCurrentUser } from '../lib/auth';
import { Navbar } from '../components/Navbar';
import { Sidebar } from '../components/Sidebar';
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
      <body className="bg-[#141210] text-[#faf6f0] min-h-screen flex flex-col antialiased">
        <Navbar user={user} />
        <Sidebar user={user} />
        <main className="flex-1 pt-[56px] pl-0 md:pl-[68px] pb-16 md:pb-8 min-h-[calc(100vh-56px)]">
          {children}
        </main>
        <div className="pl-0 md:pl-[68px]">
          <Footer />
        </div>
      </body>
    </html>
  );
}
