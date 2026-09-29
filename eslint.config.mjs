import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/AGENTS.md",
      "**/helper/**",
      "**/logo/**",
      "**/logos/**",
      "**/.agents/**",
      "**/.codex/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/target/**",
      "**/generated/**",
      "**/*.generated.*",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
