import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.ts"];
const typedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({ ...config, files: typescriptFiles }));

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "**/coverage/**",
      ".references/**",
    ],
  },
  eslint.configs.recommended,
  ...typedConfigs,
  {
    files: typescriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
