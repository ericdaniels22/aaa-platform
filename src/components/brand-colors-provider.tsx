"use client";

import { useEffect } from "react";

const BRAND_KEYS = ["brand_primary", "brand_secondary", "brand_accent"] as const;
const CSS_VAR_MAP: Record<string, string> = {
  brand_primary: "--brand-primary",
  brand_secondary: "--brand-secondary",
  brand_accent: "--brand-accent",
};

/**
 * Attempt to convert a hex color to an oklch-ish CSS gradient.
 * This allows dynamic brand colors to also drive gradient tokens.
 */
function hexToGradient(hex: string, shiftHue: number): string {
  return `linear-gradient(135deg, ${hex}, color-mix(in oklch, ${hex}, oklch(0.5 0.15 ${shiftHue})))`;
}

export default function BrandColorsProvider() {
  useEffect(() => {
    fetch("/api/settings/appearance")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: Record<string, string> | null) => {
        if (!data) return;
        const root = document.documentElement;
        for (const key of BRAND_KEYS) {
          if (data[key]) {
            root.style.setProperty(CSS_VAR_MAP[key], data[key]);
          }
        }

        // Derive gradient variables from brand colors
        if (data.brand_primary) {
          root.style.setProperty(
            "--gradient-primary",
            hexToGradient(data.brand_primary, 200)
          );
          root.style.setProperty(
            "--shadow-vibrant",
            `0 4px 14px color-mix(in oklch, ${data.brand_primary} 25%, transparent)`
          );
        }
        if (data.brand_secondary) {
          root.style.setProperty(
            "--gradient-secondary",
            hexToGradient(data.brand_secondary, 240)
          );
          root.style.setProperty(
            "--gradient-sidebar",
            `linear-gradient(180deg, ${data.brand_secondary}, color-mix(in oklch, ${data.brand_secondary}, oklch(0.14 0.03 270)))`
          );
        }
        if (data.brand_accent) {
          root.style.setProperty(
            "--gradient-accent",
            hexToGradient(data.brand_accent, 40)
          );
        }
      })
      .catch(() => {});
  }, []);

  return null;
}
