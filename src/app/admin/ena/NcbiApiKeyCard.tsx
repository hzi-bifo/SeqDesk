"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type NcbiState = { hasKey: boolean; source: "settings" | "environment" | null; requestsPerSecond: number };

/** The NCBI API key for the SRA and genome connectors. The key is write-only here: SeqDesk never shows it back. */
export function NcbiApiKeyCard() {
  const [state, setState] = useState<NcbiState | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings/ncbi").then(r => r.ok ? r.json() : null).then(setState).catch(() => setState(null));
  }, []);

  const save = async (apiKey: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/settings/ncbi", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The NCBI settings could not be saved.");
      setState(body);
      setKey("");
      setMessage({ ok: true, text: apiKey ? "Saved. NCBI requests now use this key." : "Removed the stored key." });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "The NCBI settings could not be saved." });
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
          <h2 className="text-base font-semibold">NCBI API key</h2>
          <p className="text-sm text-muted-foreground">
            Optional. The SRA and genome connectors may send NCBI {state?.hasKey ? 10 : 3} requests a second{state?.hasKey ? "" : "; with a key, 10"}.
          </p>
        </div>
        <Badge variant={state?.hasKey ? "secondary" : "outline"}>
          {state?.hasKey ? (state.source === "environment" ? "Set in the environment" : "Set") : "Not set"}
        </Badge>
      </div>
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(key.trim()); }}>
        <Label htmlFor="ncbi-api-key">{state?.source === "settings" ? "Replace the key" : "Key"}</Label>
        <div className="flex gap-2">
          <Input id="ncbi-api-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="From your NCBI account settings" />
          <Button type="submit" disabled={busy || !key.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          {state?.source === "settings" && <Button type="button" variant="outline" disabled={busy} onClick={() => void save("")}>Remove</Button>}
        </div>
        <p className="text-xs text-muted-foreground">
          Stored encrypted and sent to NCBI only; SeqDesk never shows it again. {state?.source === "environment" ? "NCBI_API_KEY in the server environment is in use; a key saved here takes precedence." : ""}
          {" "}<a className="text-blue-600 hover:underline" href="https://account.ncbi.nlm.nih.gov/settings/" target="_blank" rel="noopener noreferrer">Create a key at NCBI</a>.
        </p>
        {message && <p className={`text-sm ${message.ok ? "text-muted-foreground" : "text-red-600"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      </form>
    </GlassCard>
  );
}
