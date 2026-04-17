const ghpages = require("gh-pages");

const remove = ["**/*", "!journey", "!journey/**"];

ghpages
  .publish("dist", { remove })
  .then(() => {
    process.stdout.write("Published\n");
  })
  .catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
