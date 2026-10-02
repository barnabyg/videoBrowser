import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".scratch/**",
      ".tools/**",
      ".cache/**",
      ".verify/**",
      "build/**",
      "dist/**",
      "node_modules/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        require: "readonly",
      },
    },
  },
  // This tiny Windows handler is CommonJS so node.exe can run it directly.
  // Review when the handler is migrated to ESM; no other file is exempted.
  {
    files: ["tests/player-observer.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
