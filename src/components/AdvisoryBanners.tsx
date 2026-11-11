import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export function AdvisoryBanners() {
  return (
    <div className="mb-6 space-y-2.5">
      <div className="flex items-start gap-3 rounded-lg border border-line-soft bg-panel p-3.5 text-[12px] leading-relaxed text-[#e6edf3]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink" strokeWidth={1.5} />
        <div>
          <strong className="font-normal text-ink">Contribution model:</strong> Approving an applicant
          makes them a Crewlink contributor. It never adds them as a GitHub collaborator or grants write,
          maintain or admin access. Contributors fork the repository and open pull requests that you review
          and merge.
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-line-soft bg-panel p-3.5 text-[12px] leading-relaxed text-[#e6edf3]">
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
