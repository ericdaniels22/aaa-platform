import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import InvoiceDetailClient from "@/components/invoices/invoice-detail-client";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const { action } = await searchParams;
  return <InvoiceDetailClient invoiceId={id} autoAction={action ?? null} />;
}
