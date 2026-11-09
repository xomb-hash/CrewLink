// Starts the server. All the real code is in src/.
const { start } = require("./src/app");
start().then((s) => console.log(`Crewlink running at http://localhost:${s.address().port}`));
