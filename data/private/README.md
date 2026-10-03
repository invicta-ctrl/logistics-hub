# Private Migration Data
Ignored by Git except this file. Never commit anything placed here.

The V1.0 roster inputs (`staff.private.json`, `legacy-access.private.json`) and the script that turned them into SQL for the 0001 `staff_users` and `legacy_access_accounts` tables are retired. Since V1.3, `staff_directory` is the one directory: people are added in Administration → Staff Directory, and official ID scans are imported there by the owner from the Google Drive folder (`docs/DEPLOYMENT.md`, "V1.3 Staff Directory"). Nothing reads or writes `staff_users` (`docs/DATA_ARCHITECTURE.md`).

Downloaded scans are never placed here or anywhere in the repository.
