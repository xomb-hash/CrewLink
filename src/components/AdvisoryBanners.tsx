import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export function AdvisoryBanners() {
  return (
    <div className="mb-6 space-y-2.5">
      <div className="flex items-start gap-3 rounded-lg border border-line-soft bg-white/[0.03] p-3.5 text-[12px] leading-relaxed text-[#dedede]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink" strokeWidth={1.5} />
        <div>
          <strong className="font-normal text-ink">GitHub access level notice:</strong> Read-only
          invitations only apply on organisation repositories. On personal repositories, GitHub grants write
          access to every collaborator.
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-line-soft bg-white/[0.03] p-3.5 text-[12px] leading-relaxed text-[#dedede]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink" strokeWidth={1.5} />
        <div>
          <strong className="font-normal text-ink">Screening policy:</strong> Screening is on the honour
          system. Crewlink cannot verify that an applicant completed a third-party test. Never treat screening
          as automatically verified.
        </div>
      </div>
    </div>
  );
}
