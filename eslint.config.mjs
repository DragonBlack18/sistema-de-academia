import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    ".sites-runtime/**",
    "outputs/**",
    "work/**",
  ]),
  {
    files: ["components/Shell.tsx"],
    rules: {
      // Shell owns the history-based SPA router and its unsaved-change guard.
      // Native links keep real URLs while clicks pass through that shared guard.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    files: ["components/Brand.tsx", "components/Settings.tsx"],
    rules: {
      // Branding previews use same-origin R2 uploads of user-selected dimensions.
      // CSS supplies containment; native requests preserve the asset route semantics.
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["components/Login.tsx", "components/Dashboard.tsx"],
    rules: {
      // These two decorative heroes share a bundled JPEG with CSS-controlled crop.
      // The Worker deployment serves it directly; no image-optimizer service is configured.
      "@next/next/no-img-element": "off",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
