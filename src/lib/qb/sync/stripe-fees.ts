// 17c — posts the Stripe processing fee as a QB Purchase (expense) against a
// "Payment Processing Fees" expense account. Called from stripe-payment-bridge
// after the payment itself has synced. Fee posting is best-effort: the caller
// swallows failures so a fee-mapping miss doesn't fail the whole sync.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPurchase } from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type { QbMappingRow } from "@/lib/qb/types";

interface FeePostingInput {
  paymentId: string;
  feeAmount: number;
  stripeChargeId: string;
  paidDate: string; // yyyy-mm-dd
}

export interface FeePostingResult {
  status: "posted" | "skipped";
  qbEntityId?: string;
  reason?: string;
}

export async function postStripeFee(
  supabase: SupabaseClient,
  token: ValidToken,
  input: FeePostingInput,
): Promise<FeePostingResult> {
  if (input.feeAmount <= 0) {
    return { status: "skipped", reason: "fee_amount_zero" };
  }

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "stripe_fee_account");
  const accountMap = (mappings ?? []) as QbMappingRow[];
  const expenseAccount = accountMap.find(
    (m) => m.platform_value === "stripe_processing_fees",
  );
  if (!expenseAccount) {
    return { status: "skipped", reason: "no_mapping" };
  }

  const { data: depositMappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "payment_method");
  const deposits = (depositMappings ?? []) as QbMappingRow[];
  const bankAccount =
    deposits.find((m) => m.platform_value === "stripe_card") ??
    deposits.find((m) => m.platform_value === "stripe_ach") ??
    deposits[0];
  if (!bankAccount) {
    return { status: "skipped", reason: "no_bank_mapping" };
  }

  const purchase = await createPurchase(token, {
    PaymentType: "Cash",
    AccountRef: { value: bankAccount.qb_entity_id },
    TxnDate: input.paidDate,
    PrivateNote: `Stripe processing fee for charge ${input.stripeChargeId}`,
    Line: [
      {
        Amount: input.feeAmount,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: expenseAccount.qb_entity_id },
        },
      },
    ],
  });

  return { status: "posted", qbEntityId: purchase.id };
}
