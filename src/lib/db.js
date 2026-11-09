// Storage. Today it is one JSON file. To use a real database later, change only this file.
const fs = require("fs"), path = require("path"), config = require("../config");
const load = () => {
  try {
    const data = JSON.parse(fs.readFileSync(config.dbFile(), "utf8"));
    return { projects: Array.isArray(data.projects) ? data.projects : [], applicants: Array.isArray(data.applicants) ? data.applicants : [], drafts: Array.isArray(data.drafts) ? data.drafts : [] };
  } catch { return { projects: [], applicants: [], drafts: [] }; }
};
const save = (d) => { const f = config.dbFile(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2)); fs.renameSync(f + ".tmp", f); };
module.exports = { load, save };
