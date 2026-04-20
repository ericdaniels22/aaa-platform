"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Copy, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StripeConnectionRow } from "@/lib/stripe";

interface Props {
  initialConnection: StripeConnectionRow | null;
}

function useDebouncedPatch(setConnection: (c: StripeConnectionRow | null) => void) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);
  return useCallback(
    (field: string, value: unknown, delay = 600) => {
      const existing = timers.current.get(field);
      if (existing) clearTimeout(existing);
      const t = setTimeout(async () => {
        timers.current.delete(field);
        const res = await fetch("/api/stripe/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) {
          const { error } = (await res.json()) as { error?: string };
          toast.error(error ?? "Failed to save");
          return;
        }
        const { connection } = (await res.json()) as { connection: StripeConnectionRow };
        setConnection(connection);
        toast.success("Saved");
      }, delay);
      timers.current.set(field, t);
    },
    [setConnection],
  );
}

export default function StripeSettingsClient({ initialConnection }: Props) {
  const [connection, setConnection] = useState<StripeConnectionRow | null>(initialConnection);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const patch = useDebouncedPatch(setConnection);

  const onConnect = () => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/stripe/connect/start";
    document.body.appendChild(form);
    form.submit();
  };

  const onDisconnect = async () => {
    const res = await fetch("/api/stripe/disconnect", { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to disconnect");
      return;
    }
    setConnection(null);
    setDisconnectOpen(false);
    toast.success("Disconnected");
  };

  const onCopyAccountId = async () => {
    if (!connection) return;
    await navigator.clipboard.writeText(connection.stripe_account_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

  const truncatedAccount = `${connection.stripe_account_id.slice(0, 10)}…${connection.stripe_account_id.slice(-4)}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Stripe Payments
            <Badge
              variant={connection.mode === "live" ? "default" : "secondary"}
              className={
                connection.mode === "live"
                  ? ""
                  : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              }
            >
              {connection.mode === "live" ? "Live" : "Test"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm text-muted-foreground">Stripe account</div>
              <div className="flex items-center gap-2 font-mono text-sm">
                <span>{truncatedAccount}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onCopyAccountId}
                  aria-label={copied ? "Copied" : "Copy account ID"}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button variant="destructive" onClick={() => setDisconnectOpen(true)}>
              Disconnect
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descriptor">Statement descriptor</Label>
            <Input
              id="descriptor"
              defaultValue={connection.default_statement_descriptor ?? ""}
              maxLength={22}
              placeholder="e.g. AAA CONTRACTING"
              onChange={(e) =>
                patch("default_statement_descriptor", e.target.value.slice(0, 22) || null)
              }
            />
            <p className="text-xs text-muted-foreground">
              Up to 22 characters. Appears on your customers&rsquo; bank statements.
            </p>
          </div>

          {connection.last_connected_at && (
            <p className="text-sm text-muted-foreground">
              Connected{" "}
              {formatDistanceToNow(new Date(connection.last_connected_at), { addSuffix: true })}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Payment method toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Payment methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="ach_enabled">ACH (US bank) payments</Label>
              <p className="text-xs text-muted-foreground">
                Low fees; typically 0.8% capped at $5. Best for large invoices.
              </p>
            </div>
            <Switch
              id="ach_enabled"
              checked={connection.ach_enabled}
              onCheckedChange={(v) => {
                if (!v && !connection.card_enabled) {
                  toast.error("At least one payment method must be enabled");
                  return;
                }
                setConnection({ ...connection, ach_enabled: v });
                patch("ach_enabled", v, 50);
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="card_enabled">Card payments</Label>
              <p className="text-xs text-muted-foreground">
                Instant; ~2.9% + 30&cent; per transaction.
              </p>
            </div>
            <Switch
              id="card_enabled"
              checked={connection.card_enabled}
              onCheckedChange={(v) => {
                if (!v && !connection.ach_enabled) {
                  toast.error("At least one payment method must be enabled");
                  return;
                }
                setConnection({ ...connection, card_enabled: v });
                patch("card_enabled", v, 50);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Card surcharge */}
      <Card>
        <CardHeader>
          <CardTitle>Card processing fee</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pass_card_fee">Pass card processing fee to customer</Label>
              <p className="text-xs text-muted-foreground">
                Adds a surcharge line on card-paid invoices. Confirm legality in your jurisdiction.
              </p>
            </div>
            <Switch
              id="pass_card_fee"
              checked={connection.pass_card_fee_to_customer}
              onCheckedChange={(v) => {
                setConnection({ ...connection, pass_card_fee_to_customer: v });
                patch("pass_card_fee_to_customer", v, 50);
              }}
            />
          </div>
          {connection.pass_card_fee_to_customer && (
            <>
              <div className="space-y-2">
                <Label htmlFor="card_fee_percent">Surcharge percentage</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="card_fee_percent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="5"
                    defaultValue={connection.card_fee_percent}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v >= 0 && v <= 5) {
                        patch("card_fee_percent", v);
                      }
                    }}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Preview: $1,000 invoice would charge $
                  {(1000 + (1000 * Number(connection.card_fee_percent)) / 100).toFixed(2)} on card.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="surcharge_disclosure">Surcharge disclosure</Label>
                <textarea
                  id="surcharge_disclosure"
                  className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
                  defaultValue={
                    connection.surcharge_disclosure ??
                    "We add a surcharge to card payments that is not greater than our cost of acceptance. We do not surcharge ACH/bank payments."
                  }
                  onChange={(e) => patch("surcharge_disclosure", e.target.value || null)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ACH threshold */}
      <Card>
        <CardHeader>
          <CardTitle>ACH for large payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="ach_threshold_enabled">
                Require ACH at or above a threshold
              </Label>
              <p className="text-xs text-muted-foreground">
                Hides the card option for payments at or above this amount.
              </p>
            </div>
            <Switch
              id="ach_threshold_enabled"
              checked={connection.ach_preferred_threshold != null}
              onCheckedChange={(v) => {
                const next = v ? 5000 : null;
                setConnection({ ...connection, ach_preferred_threshold: next });
                patch("ach_preferred_threshold", next, 50);
              }}
            />
          </div>
          {connection.ach_preferred_threshold != null && (
            <div className="space-y-2">
              <Label htmlFor="ach_threshold">Amount ($)</Label>
              <Input
                id="ach_threshold"
                type="number"
                step="1"
                min="0"
                defaultValue={connection.ach_preferred_threshold}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0) patch("ach_preferred_threshold", v);
                }}
                className="w-32"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Stripe?</DialogTitle>
            <DialogDescription>
              This will clear your encrypted Stripe credentials. Existing payment records are
              preserved. You can reconnect at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
