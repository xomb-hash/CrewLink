# Projects Module

Handles repository connection, project creation, join link generation, and owner dashboard data.

- `handleGetAdminRepos`: Returns repositories where the logged-in user has admin permissions.
- `handleCreateProject`: Validates project parameters, verifies admin access, saves project, and creates join links.
- `handleGetOwnerProjects`: Serves the list of projects owned by the user, alongside applicant summaries and share links.
- `generateShareLinks`: Creates ready-to-share URLs for LinkedIn, X (Twitter), and WhatsApp.

## Security & Rules
- Verifies admin rights on GitHub before creating a project.
- Only displays applicant account age and public repository count to owners (strictly enforced).
- Surfaces mandatory advisory notices about personal repo write permissions and honour-system screening.
