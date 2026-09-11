import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next", "out", "dist", "next-env.d.ts"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Warn, not error: these were "off" entirely, which hid real defects
      // (an unreachable `let` in a Playwright spec sat unnoticed). Warning
      // keeps CI green on the existing 177 `any` usages while surfacing new
      // ones in review — tighten to "error" once the backlog is paid down.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Empty catch blocks are a deliberate idiom here (best-effort cleanup in
      // signOutAndRedirect, cache eviction); requiring a comment is enough.
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // Server/client boundary. Browser code may reference server modules for
    // their TYPES only (`import type`, erased at build); a value import would
    // pull secrets or Node APIs into the bundle. Server modules also carry
    // `import "server-only"`, which fails the Next build on the same mistake —
    // this rule reports it earlier, in the editor.
    files: [
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/lib/*.functions.ts",
      "src/app/**/*.tsx",
    ],
    // page/layout files may be Server Components.
    ignores: ["src/app/**/page.tsx", "src/app/**/layout.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/ai",
              allowTypeImports: true,
              message:
                "The @/lib/ai barrel re-exports server gateways. Import the isomorphic module directly (e.g. @/lib/ai/prompts).",
            },
          ],
          patterns: [
            {
              group: ["@/server/*", "**/*.server", "@/integrations/supabase/client.server"],
              allowTypeImports: true,
              message:
                "Server-only module. Call it through an RPC stub (src/lib/*.functions.ts) or an /api route, or use `import type`.",
            },
          ],
        },
      ],
    },
  },
  {
    // Cross-component window events go through the typed registry in
    // src/lib/app-events.ts, so an undeclared name or wrong payload is a type
    // error instead of a silently dead button.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/app-events.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='CustomEvent']",
          message:
            "Declare the event in AppEventMap (src/lib/app-events.ts) and use emitAppEvent().",
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(add|remove)EventListener$/][arguments.0.value=/:/]",
          message:
            "App events are typed: use useAppEvent / onAppEvent / addAppEventListener from src/lib/app-events.ts.",
        },
      ],
    },
  },
  eslintPluginPrettier,
);
