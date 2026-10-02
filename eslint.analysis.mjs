import tseslint from "typescript-eslint";
export default tseslint.config({
  files: ["src/**/*.ts", "tests/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { project: ["./tsconfig.json", "./tsconfig.tests.json"] },
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-for-in-array": "error",
  },
});
