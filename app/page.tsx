"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [hours, setHours] = useState(1);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationHours: hours, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar a sala");
      router.push(`/r/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a sala");
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <h1>Transfer2U</h1>
      <p className="sub">
        Mande textos e arquivos do celular para o computador (e para amigos). Sem cadastro: crie uma
        sala, compartilhe o link e ela some sozinha.
      </p>

      <form className="card" onSubmit={create}>
        <h2>Nova sala</h2>

        <label htmlFor="dur">Duração</label>
        <select id="dur" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>1 hora</option>
          <option value={24}>24 horas</option>
          <option value={168}>7 dias</option>
        </select>

        <label htmlFor="pw">Senha (opcional)</label>
        <input
          id="pw"
          type="password"
          autoComplete="new-password"
          maxLength={100}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Deixe vazio para entrar só com o link"
        />
        <p className="hint">
          Sem senha, quem tiver o link entra. Com senha, ela é pedida antes de abrir a sala.
        </p>

        <button className="primary block" disabled={busy}>
          {busy ? "Criando…" : "Criar sala"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
