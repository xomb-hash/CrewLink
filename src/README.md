# src
All the server code. `app.js` is the router. Each other folder is one feature or one concern.
Folders only call each other like this: features (`auth`, `projects`, `applicants`) use `github`, `lib` and `config`. `lib` and `config` never use features.
