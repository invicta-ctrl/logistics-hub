import tseslint from "typescript-eslint";
export default [
  { ignores: ["node_modules/**", "dist/**", ".wrangler/**", "quality/runs/**", "docs/**", "test-results/**", "playwright-report/**"] },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ["src/**/*.ts", "tests/**/*.ts"] })),
];
