"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { uploadPresigned as blobUpload } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveName, savedName } from "@/lib/client-name";

type Message = { id: string; text: string; at: number; by: string; mine: boolean };
type FileItem = { id: string; name: string; size: number; at: number; by: string; mine: boolean; image: boolean };
type Upload = { key: string; name: string; pct: number; preview?: string };
type Phase = "loading" | "join" | "gone" | "ready";

const MAX_BYTES = 50 * 1024 * 1024;
const POLL_MS = 4000;
const PREVIEW_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];

// Warnings as the room nears its end: a banner first, a popup for the last stretch.
const WARNINGS = [
  { ms: 3_600_000, label: "1 hora", popup: false },
  { ms: 600_000, label: "10 minutos", popup: false },
  { ms: 300_000, label: "5 minutos", popup: true },
  { ms: 60_000, label: "1 minuto", popup: true },
];

// Blob pathnames are built from this, so keep it to safe characters.
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-100) || "arquivo";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Stable color per person, so a conversation is easy to follow.
const hueOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const fmtTime = (at: number) =>
  new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function fmtRemaining(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

async function apiError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return (data.error as string | undefined) ?? fallback;
}

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [me, setMe] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [text, setText] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [popup, setPopup] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const version = useRef<number | null>(null);
  const warned = useRef<Set<number> | null>(null);

  // Sends the last seen version; the server answers "unchanged" cheaply when nothing happened.
  const load = useCallback(async (force = false) => {
    const q = !force && version.current !== null ? `?v=${version.current}` : "";
    const res = await fetch(`/api/rooms/${id}${q}`, { cache: "no-store" }).catch(() => null);
    if (!res) return; // offline: try again on the next tick
    if (res.status === 404) return setPhase("gone");
    if (res.status === 401) {
      setPhase("join");
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data.unchanged) return;
    version.current = data.version;
    setExpiresAt(new Date(data.expiresAt).getTime());
    setMe(data.me);
    setIsOwner(data.isOwner);
    setMessages(data.messages);
    setFiles(data.files);
    setPhase("ready");
  }, [id]);

  const join = useCallback(
    async (name: string, pw: string) => {
      setJoining(true);
      try {
        const res = await fetch(`/api/rooms/${id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password: pw }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) return setPhase("gone");
        if (data.hasPassword !== undefined) setHasPassword(!!data.hasPassword);
        if (data.needsJoin || !res.ok) {
          setJoinError(data.error ?? "");
          return setPhase("join");
        }
        saveName(data.name);
        setJoinError("");
        await load(true);
      } finally {
        setJoining(false);
      }
    },
    [id, load],
  );

  useEffect(() => {
    setLink(window.location.origin + window.location.pathname);
    const saved = savedName();
    setNameInput(saved);
    void join(saved, ""); // with no saved name this is just a probe: it tells us if a password is needed
  }, [join]);

  // Near-live updates by polling, only while the tab is visible (saves the free-tier quotas).
  useEffect(() => {
    if (phase !== "ready") return;
    const tick = () => document.visibilityState === "visible" && void load();
    const poll = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [phase, load]);

  useEffect(() => {
    if (phase !== "ready") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase === "ready" && expiresAt && now >= expiresAt) setPhase("gone");
  }, [now, expiresAt, phase]);

  // Expiry warnings. On first sight, thresholds already behind us are marked as seen (we only say
  // something if the room is close to its end); after that each one fires once as time runs out.
  useEffect(() => {
    if (phase !== "ready" || !expiresAt) return;
    const remaining = expiresAt - now;
    if (remaining <= 0) return;
    if (warned.current === null) {
      warned.current = new Set(WARNINGS.filter((w) => remaining <= w.ms).map((w) => w.ms));
      if (remaining <= 600_000) setNotice(`Esta sala expira em ${Math.max(1, Math.ceil(remaining / 60_000))} min.`);
      return;
    }
    for (const w of WARNINGS) {
      if (remaining <= w.ms && !warned.current.has(w.ms)) {
        warned.current.add(w.ms);
        const msg = `Esta sala expira em ${w.label}. Baixe o que precisar antes que tudo seja apagado.`;
        if (w.popup) setPopup(msg);
        else setNotice(msg);
      }
    }
  }, [now, expiresAt, phase]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (popup && !d.open) d.showModal();
    if (!popup && d.open) d.close();
  }, [popup, phase]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function send() {
    const value = text.trim();
    if (!value) return;
    setText("");
    const res = await fetch(`/api/rooms/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: value }),
    });
    if (!res.ok) {
      setText(value);
      setError(await apiError(res, "Não foi possível enviar"));
    } else {
      setError("");
      await load(true);
    }
  }

  const upload = useCallback(
    async (list: File[]) => {
      for (const file of list) {
        if (file.size > MAX_BYTES) {
          setError(`"${file.name}" passa de 50 MB`);
          continue;
        }
        const key = uid();
        const preview = PREVIEW_TYPES.includes(file.type) ? URL.createObjectURL(file) : undefined;
        setUploads((u) => [...u, { key, name: file.name, pct: 0, preview }]);
        try {
          // The unique prefix replaces "random suffix": presigned URLs are scoped to this exact pathname.
          const blob = await blobUpload(`t2u/${id}/${uid()}-${safeName(file.name)}`, file, {
            access: "private",
            handleUploadUrl: `/api/rooms/${id}/upload`,
            onUploadProgress: (e) =>
              setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct: Math.round(e.percentage) } : x))),
          });
          const done = await fetch(`/api/rooms/${id}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pathname: blob.pathname, name: file.name }),
          });
          if (!done.ok) throw new Error(await apiError(done, "Falha ao concluir o envio"));
          setError("");
          await load(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Falha no envio");
        } finally {
          setUploads((u) => u.filter((x) => x.key !== key));
          if (preview) URL.revokeObjectURL(preview);
        }
      }
    },
    [id, load],
  );

  // Paste a screenshot/file anywhere on the page to upload it.
  useEffect(() => {
    if (phase !== "ready") return;
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []);
      if (pasted.length) {
        e.preventDefault();
        void upload(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [phase, upload]);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Não foi possível copiar");
    }
  }

  async function removeMessage(m: Message) {
    const res = await fetch(`/api/rooms/${id}/messages/${m.id}`, { method: "DELETE" });
    if (!res.ok) setError(await apiError(res, "Não foi possível apagar"));
    await load(true);
  }

  async function removeFile(f: FileItem) {
    if (!confirm(`Apagar "${f.name}" para todos?`)) return;
    const res = await fetch(`/api/rooms/${id}/files/${f.id}`, { method: "DELETE" });
    if (!res.ok) setError(await apiError(res, "Não foi possível apagar"));
    await load(true);
  }

  async function destroy() {
    if (!confirm("Apagar esta sala e todos os arquivos agora, para todos?")) return;
    const res = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
    if (!res.ok) return setError(await apiError(res, "Não foi possível apagar a sala"));
    router.push("/");
  }

  if (phase === "loading") {
    return <main className="wrap"><p className="sub">Abrindo sala…</p></main>;
  }

  if (phase === "gone") {
    return (
      <main className="wrap">
        <div className="card">
          <h1>Sala não encontrada</h1>
          <p className="sub">O link está errado ou a sala já expirou e foi apagada.</p>
          <Link className="btn primary" href="/">Criar nova sala</Link>
        </div>
      </main>
    );
  }

  if (phase === "join") {
    return (
      <main className="wrap">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void join(nameInput, password);
          }}
        >
          <h1>Entrar na sala</h1>
          <p className="sub">Escolha como você aparece para os outros{hasPassword ? " e digite a senha" : ""}.</p>

          <label htmlFor="name">Seu nome</label>
          <input
            id="name"
            type="text"
            required
            minLength={2}
            maxLength={20}
            autoFocus
            autoComplete="nickname"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />

          {hasPassword && (
            <>
              <label htmlFor="pw">Senha</label>
              <input
                id="pw"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}

          <button className="primary block" disabled={joining}>{joining ? "Entrando…" : "Entrar"}</button>
          {joinError && <p className="error" role="alert">{joinError}</p>}
        </form>
      </main>
    );
  }

  const remaining = expiresAt - now;

  return (
    <main className="wrap">
      <div className="topbar">
        <h1><Link href="/" style={{ color: "inherit", textDecoration: "none" }}>Transfer2U</Link></h1>
        <div>
          <span className="timer">Você: <strong>{me}</strong></span>
          <span className={`timer${remaining < 300_000 ? " soon" : ""}`} style={{ marginLeft: 12 }}>
            Expira em {fmtRemaining(remaining)}
          </span>
        </div>
      </div>

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button aria-label="Fechar aviso" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      <section className="card">
        <div className="share">
          {link && (
            <div className="qr" aria-label="QR code do link da sala">
              <QRCodeSVG value={link} size={96} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2>Compartilhar</h2>
            <p className="hint" style={{ margin: "0 0 8px" }}>
              Escaneie o QR no celular ou envie o link. {link && <code>{new URL(link).host}/r/…</code>}
            </p>
            <div className="row">
              <button onClick={() => copy(link, "link")}>{copied === "link" ? "Copiado!" : "Copiar link"}</button>
              {isOwner && <button className="danger" onClick={destroy}>Apagar sala</button>}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Mensagens</h2>
        <div className="messages" ref={listRef}>
          {messages.length === 0 && <p className="empty">Nenhuma mensagem ainda.</p>}
          {messages.map((m) => (
            <div className={`msg${m.mine ? " mine" : ""}`} key={m.id}>
              <span className="actions">
                <button onClick={() => copy(m.text, `m${m.id}`)}>
                  {copied === `m${m.id}` ? "Copiado" : "Copiar"}
                </button>
                {(m.mine || isOwner) && (
                  <button className="danger" aria-label="Apagar mensagem" onClick={() => removeMessage(m)}>
                    Apagar
                  </button>
                )}
              </span>
              <span className="by" style={{ "--h": hueOf(m.by) } as React.CSSProperties}>
                {m.by}{m.mine ? " (você)" : ""}
              </span>
              {m.text}
              <small>{fmtTime(m.at)}</small>
            </div>
          ))}
        </div>
        <div className="compose">
          <textarea
            rows={2}
            value={text}
            maxLength={4000}
            placeholder="Escreva ou cole algo… (Enter envia, Shift+Enter quebra linha)"
            aria-label="Mensagem"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="primary" onClick={() => void send()} disabled={!text.trim()}>Enviar</button>
        </div>
      </section>

      <section className="card">
        <h2>Arquivos</h2>
        <label
          className={`drop${dragOver ? " over" : ""}`}
          style={{ display: "block", cursor: "pointer", fontWeight: 400 }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          Toque para escolher, arraste ou cole (Ctrl+V) arquivos · até 50 MB cada
          <input
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>

        <ul className="files">
          {uploads.map((u) => (
            <li key={u.key}>
              {u.preview && <img className="thumb" src={u.preview} alt="" />}
              <div className="name">
                {u.name}
                <progress max={100} value={u.pct} aria-label={`Enviando ${u.name}`} />
                <div className="size">{u.pct}%</div>
              </div>
            </li>
          ))}
          {files.map((f) => (
            <li key={f.id}>
              {f.image && (
                <a href={`/api/rooms/${id}/files/${f.id}?inline=1`} target="_blank" rel="noopener">
                  <img className="thumb" src={`/api/rooms/${id}/files/${f.id}?inline=1`} alt={`Prévia de ${f.name}`} loading="lazy" />
                </a>
              )}
              <div className="name">
                {f.name}
                <div className="size">
                  {fmtSize(f.size)} · {fmtTime(f.at)} ·{" "}
                  <span className="by" style={{ "--h": hueOf(f.by) } as React.CSSProperties}>
                    {f.by}{f.mine ? " (você)" : ""}
                  </span>
                </div>
              </div>
              <div className="row">
                <a className="btn" href={`/api/rooms/${id}/files/${f.id}`}>Baixar</a>
                {(f.mine || isOwner) && (
                  <button className="danger" aria-label={`Apagar ${f.name}`} onClick={() => removeFile(f)}>Apagar</button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {files.length === 0 && uploads.length === 0 && <p className="empty">Nenhum arquivo ainda.</p>}
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <dialog ref={dialogRef} className="popup" onClose={() => setPopup("")} aria-labelledby="popup-title">
        <h2 id="popup-title">A sala está acabando</h2>
        <p>{popup}</p>
        <form method="dialog">
          <button className="primary">Entendi</button>
        </form>
      </dialog>
    </main>
  );
}
