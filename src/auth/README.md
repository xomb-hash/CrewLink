# Auth Module

Manages GitHub OAuth authentication and session state.

- `handleLogin`: Initiates the GitHub OAuth flow with state verification.
- `handleCallback`: Exchanges the authorization code for a GitHub token, persists the user, and creates a signed session.
- `handleLogout`: Destroys the active session and clears the session cookie.
- `getCurrentUser`: Reads and cryptographically verifies the session cookie, returning the active user.
- `handleCurrentUserApi`: Serves safe authenticated user profile data to the client.
