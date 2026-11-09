# Applicants Module

Handles public join pages, collaborator requests, and owner approval/rejection logic.

- `handleGetJoinData`: Returns public project metadata, join mode instructions, and applicant's submission state.
- `handleApply`: Registers a user's join request with calculated GitHub account age and public repository count.
- `handleApprove`: Enforces project ownership, dispatches GitHub collaborator invitations, and updates status to `approved`.
- `handleReject`: Enforces project ownership and marks applicant as `rejected`.

## Security Rules
- Only repository owners can approve or reject applicants. This is strictly checked on the server.
- Owners cannot apply to their own repositories.
- Duplicate applications from the same user are prevented.
- No sensitive user data (email, IP, activity) is recorded or shared with owners beyond account age and public repo count.
