import { loadStripeConnection } from "@/lib/stripe";
import StripeSettingsClient from "./stripe-settings-client";

export const dynamic = "force-dynamic";

export default async function StripeSettingsPage() {
  const connection = await loadStripeConnection();
  return <StripeSettingsClient initialConnection={connection} />;
}
