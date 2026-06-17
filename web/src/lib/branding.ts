export const PRODUCT_NAME = "Knot";
export const PRODUCT_TAGLINE = "社内ナレッジをつなぐAIデスク";
export const PRODUCT_FOOTER = "Built on Onyx OSS";

export function productDisplayName(configuredName?: string | null) {
  const trimmedName = configuredName?.trim();
  if (!trimmedName || /^onyx( chat)?$/i.test(trimmedName)) {
    return PRODUCT_NAME;
  }

  return trimmedName;
}
