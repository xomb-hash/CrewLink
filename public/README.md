# Public Assets

Frontend presentation layer for Crewlink.

- `index.html`: Landing page explaining Crewlink's purpose, flow, and entry points.
- `styles/main.css`: Core theme, typography, layout, and global utility classes.
- `components/`: Modular UI building blocks (button, form, dialog, tag, toast, project card, visibility icon).
- `features/`: Page templates and scripts for dashboard, join, and project creation.
- `shared/`: Common navbar, footer, and API wrapper.

## Rules
- No npm packages or build step (Vite/Webpack) are required. All scripts run natively in modern browsers.
- Always reuse components in `components/` before creating custom styles.
