import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import InvoiceNewClient from "@/components/invoices/invoice-new-client";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  return <InvoiceNewClient prefillJobId={params.jobId ?? null} />;
}
