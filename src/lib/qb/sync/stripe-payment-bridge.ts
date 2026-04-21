// Stub: Task 15 replaces with the real implementation that calls
// syncPayment (invoice-linked) or falls back to a generic income posting
// for standalone deposits, and posts the Stripe fee separately.
export async function syncPaymentToQb(_paymentId: string): Promise<void> {
  throw new Error("syncPaymentToQb not yet implemented (Task 15 stub)");
}
