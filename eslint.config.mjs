import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The evolution engine must stay pure: no UI, I/O or hidden randomness,
  // so it runs anywhere and its tests are deterministic.
  {
    files: ["src/engine/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "react/*",
                "react-dom/*",
                "next",
                "next/*",
                "tone",
                "tone/*",
                "@supabase/*",
                "stripe",
                "@stripe/*",
              ],
              message:
                "src/engine must not depend on UI, audio or I/O libraries.",
            },
          ],
        },
      ],
      // Covers both "@/app/..." and relative imports such as "../app/page".
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/engine",
              from: "./src",
              except: ["./engine"],
              message: "src/engine may only import from src/engine.",
            },
          ],
        },
      ],
      "import/no-nodejs-modules": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Inject a seedable RNG (see src/engine/rng.ts).",
        },
        {
          object: "Date",
          property: "now",
          message: "Pass time in as data so runs stay reproducible.",
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "self",
        "globalThis",
        "document",
        "navigator",
        "location",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "crypto",
      ],
    },
  },
  // Turn off rules that conflict with Prettier; keep this last.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
