"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type DryadState = { hasAccount: boolean; source: "settings" | "environment" | null; changedBy: string | null; changedAt: string | null };

/** The Dryad API account for dataset downloads. Write-only like the NCBI key: SeqDesk never shows it back. */
export function DryadAccountCard() {
  const [state, setState] = useState<DryadState | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/dryad").then(r => r.ok ? r.json() : null).then(setState).catch(() => setState(null));
  }, []);

  const save = async (id: string, secret: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/settings/dryad", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId: id, clientSecret: secret }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The Dryad settings could not be saved.");
      setState(body);
      setClientId("");
      setClientSecret("");
      setMessage({ ok: true, text: id ? "Saved. Dryad downloads now use this account." : "Removed the stored account." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "The Dryad settings could not be saved." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold">Dryad API account</h2>
          <p className="text-sm text-muted-foreground">Previews work without one. Dryad hands out files only to registered API accounts.</p>
        </div>
        <Badge variant={state?.hasAccount ? "secondary" : "outline"}>
          {state?.hasAccount ? (state.source === "environment" ? "Set in the environment" : "Set") : "Not set"}
        </Badge>
      </div>
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (clientId.trim() && clientSecret.trim()) void save(clientId.trim(), clientSecret.trim()); }}>
        <Label htmlFor="dryad-client-id">Client id</Label>
        <Input id="dryad-client-id" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From your Dryad API account" />
        <Label htmlFor="dryad-client-secret">Client secret</Label>
        <div className="flex gap-2">
          <Input id="dryad-client-secret" type="password" autoComplete="off" spellCheck={false} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          <Button type="submit" disabled={busy || !clientId.trim() || !clientSecret.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          {state?.source === "settings" && <Button type="button" variant="outline" disabled={busy} onClick={() => void save("", "")}>Remove</Button>}
        </div>
        <p className="text-xs text-muted-foreground">
          Stored encrypted and sent to Dryad only; SeqDesk never shows it again.
          {state?.changedBy && state.changedAt ? ` Last changed by ${state.changedBy} on ${new Date(state.changedAt).toLocaleString()}.` : ""}
          {state?.source === "environment" ? " SEQDESK_DRYAD_CLIENT_ID/SECRET in the server environment are in use; an account saved here takes precedence." : ""}
        </p>
        {message && <p className={`text-sm ${message.ok ? "text-muted-foreground" : "text-red-600"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      </form>
    </GlassCard>
  );
}
