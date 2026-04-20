"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CreditCard } from "lucide-react";
import type { StripeConnectionRow } from "@/lib/stripe";

interface Props {
  initialConnection: StripeConnectionRow | null;
}

export default function StripeSettingsClient({ initialConnection }: Props) {
  const [connection] = useState<StripeConnectionRow | null>(initialConnection);

  const onConnect = () => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/stripe/connect/start";
    document.body.appendChild(form);
    form.submit();
  };

  if (!connection) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Stripe Payments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Connect your Stripe account to accept online card and ACH payments for
              invoices and deposits. Credentials are stored encrypted in your database —
              never in configuration files.
            </p>
            <Button onClick={onConnect} size="lg">
              Connect Stripe Account
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Connected-state UI lands in Task 14. For now render a placeholder so this
  // component compiles and doesn't break the page if a row happens to exist.
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Stripe Payments</CardTitle>
        </CardHeader>
        <CardContent>Connected to {connection.stripe_account_id}</CardContent>
      </Card>
    </div>
  );
}
