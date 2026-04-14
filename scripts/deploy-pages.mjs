import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ghpages from "gh-pages";

const publish = ghpages.publish;

const targets = {
  root: {
    base: "/js-renderer/",
    publishOptions: {
      branch: "gh-pages",
      message: "Deploy root site",
      nojekyll: true,
      remove: ["**/*", "!journey", "!journey/**"],
    },
  },
  journey: {
    base: "/js-renderer/journey/",
    publishOptions: {
      branch: "gh-pages",
      dest: "journey",
      message: "Deploy journey site",
      nojekyll: true,
    },
  },
};

const branchTargets = {
  main: "root",
  master: "root",
  "console-journey": "journey",
};

function getCurrentBranch() {
  return execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
}

export function resolveTargetName(name, branch = getCurrentBranch()) {
  if (name) {
    return name;
  }

  return branchTargets[branch];
}

async function main() {
  const targetName = resolveTargetName(process.argv[2]);
  const target = targets[targetName];

  if (!target) {
    const branch = getCurrentBranch();
    console.error(
      targetName
        ? `Unknown deploy target "${targetName}". Use one of: ${Object.keys(targets).join(", ")}.`
        : `Current branch "${branch}" is not mapped to a deploy target. Add it to branchTargets or use one of: ${Object.keys(targets).join(", ")}.`,
    );
    process.exit(1);
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  execFileSync(npmCommand, ["run", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      PAGES_BASE: target.base,
    },
  });

  await publish("dist", target.publishOptions);

  const urlSuffix = targetName === "journey" ? "/journey" : "";
  console.log(`Published ${targetName} site to gh-pages${urlSuffix}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
