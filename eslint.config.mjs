"use strict";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      globals: Object.assign(Object.assign({}, globals.node), globals.es2021),
    },
    rules: {
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    ignores: ["node_modules/**", "dist/**", "build/**"],
  },
];
