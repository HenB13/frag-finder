const getFrags = require("../lib/get-frags.js");
const createFiles = require("../lib/create-files.js");

(async function () {
    try {
        const highlights = await getFrags("./test/json");
        await createFiles(highlights, "./test/exports");
        console.log("files created!");
    } catch (e) {
        console.log("something went wrong:", e);
    }
})();