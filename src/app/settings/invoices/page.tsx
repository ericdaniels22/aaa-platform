"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import EmailTemplateField from "@/components/contracts/email-template-field";
import type { InvoiceEmailSettings } from "@/lib/qb/types";

interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
}

export default function InvoiceEmailSettingsPage() {
  const [settings, setSettings] = useState<InvoiceEmailSettings | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [sRes, aRes] = await Promise.all([
      fetch("/api/settings/invoice-email"),
      fetch("/api/email/accounts"),
    ]);
    if (sRes.ok) setSettings((await sRes.json()) as InvoiceEmailSettings);
    else toast.error("Failed to load invoice email settings");
    if (aRes.ok) setAccounts((await aRes.json()) as EmailAccount[]);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function patch<K extends keyof InvoiceEmailSettings>(key: K, value: InvoiceEmailSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/invoice-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      setDirty(false);
      toast.success("Invoice email settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Invoice email</h1>
        <p className="text-sm text-muted-foreground">
          Configure how invoice emails are sent and what templates they use.
        </p>
      </div>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Provider</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={settings.provider === "resend"}
            onChange={() => patch("provider", "resend")}
          />
          Resend (platform default)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={settings.provider === "email_account"}
            onChange={() => patch("provider", "email_account")}
          />
          Send from a connected email account
        </label>
        {settings.provider === "email_account" && (
          <select
            className="border border-border rounded-lg px-3 py-2 bg-background text-sm"
            value={settings.email_account_id ?? ""}
            onChange={(e) => patch("email_account_id", e.target.value || null)}
          >
            <option value="">Select account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.email_address}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Identity</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            From name
            <input
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              value={settings.send_from_name ?? ""}
              onChange={(e) => patch("send_from_name", e.target.value)}
            />
          </label>
          <label className="text-sm">
            From email
            <input
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              value={settings.send_from_email ?? ""}
              onChange={(e) => patch("send_from_email", e.target.value)}
            />
          </label>
        </div>
        <label className="text-sm block">
          Reply-to (optional)
          <input
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            value={settings.reply_to_email ?? ""}
            onChange={(e) => patch("reply_to_email", e.target.value)}
          />
        </label>
      </section>

      <section className="bg-card border border-border rounded-xl p-5">
        <EmailTemplateField
          label="Invoice email template"
          description="Sent when you use Send Invoice on a draft."
          subject={settings.subject_template}
          body={settings.body_template}
          onSubjectChange={(v) => patch("subject_template", v)}
          onBodyChange={(v) => patch("body_template", v)}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>
    </div>
  );
}
