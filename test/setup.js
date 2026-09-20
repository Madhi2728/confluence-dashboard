import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement these -- stub them so components using
// URL.createObjectURL for local file previews are actually testable
// instead of just being feature-detected away in this environment.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock-url";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}
