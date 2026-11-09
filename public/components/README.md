# UI Components

Reusable UI components for the Crewlink frontend.

- `button.js` / `button.css`: Buttons with primary, secondary, and danger styles.
- `form.js` / `form.css`: Inputs, labels, hints, and radio card selectors.
- `dialog.js` / `dialog.css`: Modal confirmation dialogs for approve/reject and share actions.
- `tag.js` / `tag.css`: Status badges (pending, approved, rejected) and join mode badges (referral, screening).
- `toast.js` / `toast.css`: Non-blocking feedback notification popups.
- `visibility-icon.js` / `visibility-icon.css`: Lock icon for private repositories, globe icon for public repositories.
- `project-card.js` / `project-card.css`: Complete project card displaying repository links, join link toolbar, share triggers, and applicant review cards with Approve/Reject actions.

## Rules
- Always reuse these components across pages rather than creating duplicate styles.
- Clicking a public repository must link to GitHub.
- Private repositories must clearly show the lock icon.
