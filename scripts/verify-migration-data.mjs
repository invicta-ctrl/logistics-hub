import fs from "node:fs";
const a=JSON.parse(fs.readFileSync(new URL("../data/migration/inventory.production.json",import.meta.url),"utf8"));
const r=JSON.parse(fs.readFileSync(new URL("../data/migration/inventory-reconciliation.json",import.meta.url),"utf8"));
const ids=a.items.map(x=>x.id);
if(a.itemCount!==397||a.items.length!==397) throw new Error("Expected 397 inventory items");
if(new Set(ids).size!==ids.length) throw new Error("Duplicate inventory IDs");
if(r.productionVsLatestBackupMismatchCount!==0) throw new Error("Production/latest backup inventory mismatch");
console.log(JSON.stringify({ok:true,items:a.items.length,ledgerRows:r.postedLedgerRows,reservationRows:r.reservationRows,balanceMismatches:r.computedBalanceMismatchCount},null,2));
