import type { VendorType, PaymentMethod } from "./types";

export interface VendorTypeConfig {
  value: VendorType;
  label: string;
  bg: string;
  text: string;
}

export const VENDOR_TYPES: VendorTypeConfig[] = [
  { value: "supplier",          label: "Supplier",           bg: "#E6F1FB", text: "#0C447C" },
  { value: "subcontractor",     label: "Subcontractor",      bg: "#EEEDFE", text: "#3C3489" },
  { value: "equipment_rental",  label: "Equipment Rental",   bg: "#FAEEDA", text: "#633806" },
  { value: "fuel",              label: "Fuel",               bg: "#FAECE7", text: "#712B13" },
  { value: "other",             label: "Other",              bg: "#F1EFE8", text: "#5F5E5A" },
];

export function vendorTypeConfig(value: VendorType): VendorTypeConfig {
  return VENDOR_TYPES.find((t) => t.value === value) ?? VENDOR_TYPES[VENDOR_TYPES.length - 1];
}

export interface PaymentMethodConfig {
  value: PaymentMethod;
  label: string;
}

export const PAYMENT_METHODS: PaymentMethodConfig[] = [
  { value: "business_card",      label: "Business Card" },
  { value: "business_ach",       label: "Business ACH" },
  { value: "cash",               label: "Cash" },
  { value: "personal_reimburse", label: "Personal (Reimburse)" },
  { value: "other",              label: "Other" },
];

export function paymentMethodLabel(value: PaymentMethod): string {
  return PAYMENT_METHODS.find((p) => p.value === value)?.label ?? "Other";
}

export function formatAmount(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
