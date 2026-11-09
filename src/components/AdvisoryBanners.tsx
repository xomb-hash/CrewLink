import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

export function AdvisoryBanners() {
  return (
    <div className="space-y-3 mb-6">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm leading-relaxed">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold text-amber-200">GitHub Access Level Notice:</strong> Read-only invitations only apply on organisation repositories. On personal repositories, GitHub grants write access to every collaborator.
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm leading-relaxed">
        <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold text-blue-200">Screening Policy:</strong> Screening is on the honour system. Crewlink cannot verify that an applicant completed a third-party test. Never treat screening as automatically verified.
        </div>
      </div>
    </div>
  );
}
