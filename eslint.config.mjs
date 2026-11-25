import tseslint from "typescript-eslint";
export default [
  { ignores: ["node_modules/**", "dist/**", ".wrangler/**", "quality/runs/**", "docs/**", "test-results/**", "playwright-report/**"] },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ["src/**/*.ts", "tests/**/*.ts"] })),
  // Explicitly discarded object-rest fields (including private session fields) are intentional, not dead code.
  { files: ["src/**/*.ts", "tests/**/*.ts"], rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true, reportUsedIgnorePattern: true }] } },
];
