import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // Эти экспериментальные правила React Compiler не были включены в
    // прежней конфигурации проекта и требуют отдельного рефакторинга UI.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
  ]),
]);
