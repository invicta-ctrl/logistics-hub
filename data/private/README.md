# Private Migration Data
Ignored by Git except this file.

Place verified private roster at `data/private/staff.private.json` as an array of {id,email,displayName,role,department,committee,active}. Never commit it. Run `node scripts/build-private-staff-seed.mjs` locally.
