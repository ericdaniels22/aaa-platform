"use client";

import { useEffect } from "react";

const BRAND_KEYS = ["brand_primary", "brand_secondary", "brand_accent"] as const;
const CSS_VAR_MAP: Record<string, string> = {
  brand_primary: "--brand-primary",
  brand_secondary: "--brand-secondary",
  brand_accent: "--brand-accent",
};

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
      })
      .catch(() => {});
  }, []);

  return null;
}
