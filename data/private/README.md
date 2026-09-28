# Private Migration Data
Ignored by Git except this file.

Files:
- `staff.private.json`: verified DOL directory rows. Email may be null when identity is known but login email is not.
- `legacy-access.private.json`: old Production access rows kept separate until identities are reconciled.
- `staff.seed.sql`: generated private SQL.

Never commit these files.

Staff row shape:
```json
{"id":"USR-DOL-0001","email":null,"displayName":"Name","role":"DIRECTOR","department":"Department of Logistics","committee":null,"active":true,"loginEnabled":false}
```

Run `node scripts/build-private-staff-seed.mjs`.
