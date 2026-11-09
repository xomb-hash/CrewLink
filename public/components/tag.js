export function renderTag(label, type = 'default') {
  return `<span class="tag tag-${type}">${label}</span>`;
}

export function renderStatusTag(status) {
  const normalized = (status || 'pending').toLowerCase();
  let label = 'Pending';
  if (normalized === 'approved') label = 'Approved';
  if (normalized === 'rejected') label = 'Rejected';

  return renderTag(label, normalized);
}

export function renderModeTag(mode) {
  const normalized = (mode || 'referral').toLowerCase();
  const label = normalized === 'screening' ? 'Screening first' : 'Referral link';
  return renderTag(label, normalized);
}
