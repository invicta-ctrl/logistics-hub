import fs from "node:fs";

const source = JSON.parse(fs.readFileSync(new URL("../data/migration/inventory.production.json", import.meta.url), "utf8"));
const audiences = new Set(["STUDENTS_AND_USC_STAFF", "USC_STAFF_ONLY"]);
const types = new Set(["EQUIPMENT", "FURNITURE", "AUDIO_VISUAL_EQUIPMENT"]);
const approved = source.items.filter((item) => item.status === "ACTIVE" && item.needsReview === false && audiences.has(item.lendingAudience) && types.has(item.itemType) && item.openingQty > 0);
const pendingReview = source.items.filter((item) => item.needsReview === true).length;
const nonLendable = source.items.filter((item) => item.lendingAudience === "NOT_AVAILABLE_FOR_LENDING").length;
console.log(JSON.stringify({ sourceItems: source.itemCount, pendingReview, explicitlyNotAvailableForLending: nonLendable, publiclyLendableFromMigrationSnapshot: approved.length }, null, 2));
if (source.itemCount !== source.items.length) process.exitCode = 1;
