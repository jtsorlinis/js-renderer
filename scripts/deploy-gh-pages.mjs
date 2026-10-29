import { execSync } from "node:child_process";
import process from "node:process";
import ghpages from "gh-pages";

async function main() {
  // Run through the shell, as Node refuses to spawn npm.cmd directly on Windows
  execSync("npm run build", {
    stdio: "inherit",
    env: {
      ...process.env,
      PAGES_BASE: "/js-renderer/journey/",
    },
  });

  await ghpages.publish("dist", {
    branch: "gh-pages",
    dest: "journey",
    message: "Deploy journey site",
    nojekyll: true,
  });

  process.stdout.write("Published journey site to gh-pages/journey.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
