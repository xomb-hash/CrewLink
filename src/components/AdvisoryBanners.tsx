import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export function AdvisoryBanners() {
  return (
    <div className="mb-6 space-y-2.5">
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3.5 text-[12px] leading-relaxed text-amber-200/90">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.5} />
        <div>
          <strong className="font-normal text-amber-200">GitHub access level notice:</strong> Read-only
          invitations only apply on organisation repositories. On personal repositories, GitHub grants write
          access to every collaborator.
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.05] p-3.5 text-[12px] leading-relaxed text-blue-200/90">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" strokeWidth={1.5} />
        <div>
          <strong className="font-normal text-blue-200">Screening policy:</strong> Screening is on the honour
          system. Crewlink cannot verify that an applicant completed a third-party test. Never treat screening
          as automatically verified.
        </div>
      </div>
    </div>
  );
}
