"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SoundToggle } from "@/components/SoundToggle";
import { Tape } from "@/components/Tape";
import { saveName, savedName } from "@/lib/client-name";

const DURATIONS = [
  { hours: 1, label: "1 h" },
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 d" },
];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [hours, setHours] = useState(1);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState("");

  useEffect(() => setName(savedName()), []);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setCodeBusy(true);
    setCodeError("");
    try {
      const res = await fetch("/api/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Não foi possível entrar");
      router.push(`/r/${data.id}`);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : "Não foi possível entrar");
      setCodeBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, durationHours: hours, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar a sala");
      saveName(name.trim());
      router.push(`/r/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar a sala");
      setBusy(false);
    }
  }

  return (
    <main className="home">
      <div className="statement">
        <h1 className="brand">Transfer<span>2U</span></h1>
        <div className="statement-foot">
          <h2 className="tagline"><span>Imprime aqui.</span> <span>Recebe lá.</span></h2>
          <p>Textos e arquivos do celular para o computador, ou para quem você quiser. Sem cadastro, e tudo some quando a sala acaba.</p>
          <ol className="steps">
            <li>Crie uma sala</li>
            <li>Abra em outro aparelho ou chame alguém com o código ou o QR</li>
            <li>Mande textos e arquivos</li>
          </ol>
        </div>
      </div>

      <Tape>
        <form onSubmit={enter}>
          <label htmlFor="code">Já tem um código?</label>
          <div className="code-field">
            <input
              id="code"
              type="text"
              required
              maxLength={7}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="K7M2QX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn-solid" disabled={codeBusy}>{codeBusy ? "Entrando…" : "Entrar"}</button>
          </div>
          {codeError && <p className="error" role="alert">{codeError}</p>}
        </form>

        <div className="cut">ou</div>

        <form onSubmit={create}>
          <h2 className="section-title">Nova sala</h2>

          <label htmlFor="name">Seu nome</label>
          <input
            id="name"
            type="text"
            required
            minLength={2}
            maxLength={20}
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <fieldset>
            <legend>Duração</legend>
            <div className="choices">
              {DURATIONS.map((d) => (
                <label key={d.hours}>
                  <input
                    type="radio"
                    name="duration"
                    checked={hours === d.hours}
                    onChange={() => setHours(d.hours)}
                  />
                  <span>{d.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label htmlFor="pw">Senha (opcional)</label>
          <input
            id="pw"
            type="password"
            autoComplete="new-password"
            maxLength={100}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="hint">Sem senha, entra quem tiver o link ou o código.</p>

          <button className="btn btn-solid btn-wide" disabled={busy}>{busy ? "Criando…" : "Criar sala"}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>

        <div className="receipt-foot">
          {[
            ["Arquivo", "até 50 MB"],
            ["Duração", "até 7 dias"],
            ["Cadastro", "nenhum"],
            ["Custo", "R$ 0,00"],
          ].map(([label, value]) => (
            <div className="total" key={label}>
              <span>{label}</span>
              <span className="dots" aria-hidden="true" />
              <span>{value}</span>
            </div>
          ))}
          <div className="foot-sound"><SoundToggle /></div>
          <div className="barcode" aria-hidden="true" />
        </div>
      </Tape>
    </main>
  );
}
