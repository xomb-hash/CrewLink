// Storage. Today it is one JSON file. To use a real database later, change only this file.
const fs = require("fs"), path = require("path"), config = require("../config");
const load = () => { try { return JSON.parse(fs.readFileSync(config.dbFile(), "utf8")); } catch { return { projects: [], applicants: [] }; } };
const save = (d) => { const f = config.dbFile(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2)); fs.renameSync(f + ".tmp", f); };
module.exports = { load, save };
