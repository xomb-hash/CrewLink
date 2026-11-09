# applicants
- `join-page.js`: the page opened from a join link.
- `routes.js`: request to join, and owner approve or reject. Approve calls `github/invite.js`.
If GitHub refuses an invitation, the status stays unchanged. Keep that behaviour.
