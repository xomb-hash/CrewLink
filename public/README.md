# public
Everything the browser loads. `index.html` is only the page skeleton; each piece of the page lives in its own folder.
- `styles/`: colours and page layout for the whole app.
- `components/`: reusable pieces (buttons, forms, pop-up window, tags, messages, project card).
- `features/`: the things a person does (sign in, create a project, manage requests).
- `shared/`: helpers used by many pieces, including every call to the backend.
No build step. Edit a file, refresh the browser.
