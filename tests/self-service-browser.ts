import { expect, type FrameLocator, type Locator, type Page } from "@playwright/test";

/** A page, a sheet or a framed panel: anywhere the Self-Service form is open. */
type Scope = Page | Locator | FrameLocator;

/** A camera photo, made in the page, handed to the file input as a person would. */
export async function attachPhoto(scope: Scope): Promise<void> {
  await scope.locator("#ss-photo").evaluate(async (input: HTMLInputElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 640;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#7a1419";
    context.fillRect(0, 0, 480, 640);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/jpeg", 0.8));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(scope.getByAltText("Photo to attach")).toBeVisible();
}

/** What every Self-Service action asks for: a full name, an eight-digit Student ID number and a photo. */
export async function identify(scope: Scope, name = "Ana Reyes", studentId = "21000115"): Promise<void> {
  await scope.locator("#ss-name").fill(name);
  await scope.locator("#ss-student").fill(studentId);
  await attachPhoto(scope);
}
