import fs from "node:fs";

// Mirrors isListedForLending() in src/catalog-policy.ts against the migration snapshot.
const source = JSON.parse(fs.readFileSync(new URL("../data/migration/inventory.production.json", import.meta.url), "utf8"));
const audiences = new Set(["STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"]);
const listed = source.items.filter((item) => item.status === "ACTIVE" && item.needsReview === false && audiences.has(item.lendingAudience) && item.itemType === "Loanable");
const pendingReview = source.items.filter((item) => item.needsReview === true).length;
const loanableAwaitingReview = source.items.filter((item) => item.itemType === "Loanable" && item.needsReview === true).length;
console.log(JSON.stringify({ sourceItems: source.itemCount, pendingReview, loanableAwaitingReview, publiclyListedFromMigrationSnapshot: listed.length }, null, 2));
if (source.itemCount !== source.items.length) process.exitCode = 1;
