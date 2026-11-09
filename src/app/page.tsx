import React from 'react';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { GitBranch, ShieldCheck, UserCheck, ArrowRight } from 'lucide-react';

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-semibold uppercase tracking-wider mb-6">
        Crewlink for GitHub
      </div>

      <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight mb-6 max-w-3xl mx-auto">
        Where builders find each other and start creating together.
      </h1>

      <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
        Connect a GitHub repository, share one join link, and decide who comes aboard. Once approved, Crewlink sends real GitHub collaborator invitations.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-4 mb-16">
        {user ? (
          <>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/40"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#21262d] text-gray-200 border border-[#30363d] font-medium hover:bg-[#30363d] transition"
            >
              + Connect New Repository
            </Link>
          </>
        ) : (
          <>
            <a
              href="/auth/github"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/40"
            >
              <span>Sign in with GitHub</span>
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#21262d] text-gray-200 border border-[#30363d] font-medium hover:bg-[#30363d] transition"
            >
              How it works
            </a>
          </>
        )}
      </div>

      <section id="how-it-works" className="text-left pt-6 border-t border-[#30363d]/60">
        <h2 className="text-center text-2xl font-bold text-white mb-8">How Crewlink Works</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
              <GitBranch className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">1. Connect your repo</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Sign in with GitHub and select a repository where you have administrative access.
            </p>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">2. Choose join mode</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Pick <strong>Referral link</strong> for standard review or <strong>Screening first</strong> to require an interview or test link first.
            </p>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
              <UserCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">3. Review &amp; Invite</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              Review applicants by account age and public repo count. Approving dispatches a real GitHub collaborator invitation.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-12 bg-[#161b22] border border-[#30363d] rounded-xl p-6 text-left">
        <h3 className="text-base font-bold text-white mb-2">Purpose-built for connecting builders</h3>
        <p className="text-sm text-gray-400 leading-relaxed">
          Crewlink only connects people. It is not a chat app and does not track post-approval team performance. Once approved on GitHub, teams continue collaborating on GitHub, Discord, or WhatsApp.
        </p>
      </section>
    </div>
  );
}
