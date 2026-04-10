export type Category = "general" | "promotions" | "social" | "purchases";

export interface CategoryRule {
  match_type: "sender_address" | "sender_domain" | "header" | "body_pattern" | "subject_pattern";
  match_value: string;
  category: Category;
}

export interface EmailForCategorization {
  from_address: string;
  subject: string;
  headers?: Record<string, string>;
  body_text?: string | null;
}

/**
 * Categorize an email by matching against a pre-loaded list of rules.
 * Match order (first match wins):
 *   1. sender_address (exact, case-insensitive)
 *   2. sender_domain (suffix match on domain portion of from_address)
 *   3. header (case-insensitive presence of the named header)
 *   4. body_pattern (case-insensitive regex match against body_text)
 *   5. subject_pattern (case-insensitive regex match against subject)
 * Fallback: "general".
 */
export function categorizeEmail(
  email: EmailForCategorization,
  rules: CategoryRule[]
): Category {
  const fromLower = email.from_address.toLowerCase();
  const subject = email.subject || "";
  const headers = email.headers || {};
  const bodyText = email.body_text || "";

  // Extract domain from "name@domain.tld" — take everything after the last "@"
  const atIdx = fromLower.lastIndexOf("@");
  const fromDomain = atIdx >= 0 ? fromLower.slice(atIdx + 1) : "";

  // 1. sender_address exact match
  for (const rule of rules) {
    if (rule.match_type === "sender_address") {
      if (rule.match_value.toLowerCase() === fromLower) {
        return rule.category;
      }
    }
  }

  // 2. sender_domain suffix match
  for (const rule of rules) {
    if (rule.match_type === "sender_domain") {
      const target = rule.match_value.toLowerCase();
      if (fromDomain === target || fromDomain.endsWith("." + target)) {
        return rule.category;
      }
    }
  }

  // 3. header presence
  for (const rule of rules) {
    if (rule.match_type === "header") {
      const headerName = rule.match_value.toLowerCase();
      if (headerName in headers) {
        return rule.category;
      }
    }
  }

  // 4. body_pattern regex
  if (bodyText) {
    for (const rule of rules) {
      if (rule.match_type === "body_pattern") {
        try {
          const re = new RegExp(rule.match_value, "i");
          if (re.test(bodyText)) {
            return rule.category;
          }
        } catch {
          // Invalid regex in DB — skip
        }
      }
    }
  }

  // 5. subject_pattern regex
  for (const rule of rules) {
    if (rule.match_type === "subject_pattern") {
      try {
        const re = new RegExp(rule.match_value, "i");
        if (re.test(subject)) {
          return rule.category;
        }
      } catch {
        // Invalid regex in DB — skip
      }
    }
  }

  return "general";
}
