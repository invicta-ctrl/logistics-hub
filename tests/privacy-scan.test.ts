import { describe, expect, it } from "vitest";
import { rosterKey } from "../scripts/privacy-scan.mjs";

describe("privacy scan: which private-roster keys hold personal values", () => {
  it("catches names, display names, any full_name and any email key", () => {
    for (const key of ["name", "Name", "display_name", "name_en", "full_name", "owner_full_name", "full_name_en", "email", "contact_email", "EMAIL"]) expect(rosterKey(key), key).toBe(true);
  });

  it("leaves keys that only mention a name or email in passing", () => {
    for (const key of ["username", "department", "email_verified", "id", "rename", "position"]) expect(rosterKey(key), key).toBe(false);
  });
});
