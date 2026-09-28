import { execFileSync } from "node:child_process";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
const prohibited = tracked.filter((file) => file === ".dev.vars" || file.startsWith("data/private/") && file !== "data/private/README.md" || /(^|\/)(\.env|.*\.pem|.*\.key)$/i.test(file));
if (prohibited.length) {
  console.error(`Prohibited tracked paths: ${prohibited.join(", ")}`);
  process.exit(1);
}
console.log("privacy-scan: tracked private data and secret-file path checks passed");
