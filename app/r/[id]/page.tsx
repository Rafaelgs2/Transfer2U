"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { uploadPresigned as blobUpload } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = { id: string; text: string; at: number };
type FileItem = { id: string; name: string; size: number; at: number };
type Phase = "loading" | "password" | "gone" | "ready";

const MAX_BYTES = 50 * 1024 * 1024;
const POLL_MS = 4000;

// Blob pathnames are built from this, so keep it to safe characters.
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-100) || "arquivo";

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

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [text, setText] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const version = useRef<number | null>(null);

  // Sends the last seen version; the server answers "unchanged" cheaply when nothing happened.
  const load = useCallback(async (force = false) => {
    const q = !force && version.current !== null ? `?v=${version.current}` : "";
    const res = await fetch(`/api/rooms/${id}${q}`, { cache: "no-store" }).catch(() => null);
    if (!res) return; // offline: try again on the next tick
    if (res.status === 404) return setPhase("gone");
    if (res.status === 401) return setPhase("password");
    if (!res.ok) return;
    const data = await res.json();
    if (data.unchanged) return;
    version.current = data.version;
    setExpiresAt(new Date(data.expiresAt).getTime());
    setMessages(data.messages);
    setFiles(data.files);
    setPhase("ready");
  }, [id]);

  const join = useCallback(
    async (pw?: string) => {
      const res = await fetch(`/api/rooms/${id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) return setPhase("gone");
      if (res.status === 401) {
        setPhase("password");
        if (pw) setError(data.error ?? "Senha incorreta");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Não foi possível entrar");
        return setPhase("password");
      }
      setError("");
      await load();
    },
    [id, load],
  );

  useEffect(() => {
    setLink(window.location.href);
    join();
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
      const data = await res.json().catch(() => ({}));
      setText(value);
      setError(data.error ?? "Não foi possível enviar");
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
        setUploading((u) => [...u, file.name]);
        try {
          // 1) straight to Vercel Blob with a token from our API, 2) register it in the room.
          // The unique prefix replaces "random suffix": presigned URLs are scoped to this exact pathname.
          const blob = await blobUpload(`t2u/${id}/${crypto.randomUUID()}-${safeName(file.name)}`, file, {
            access: "private",
            handleUploadUrl: `/api/rooms/${id}/upload`,
          });
          const done = await fetch(`/api/rooms/${id}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pathname: blob.pathname, name: file.name }),
          });
          if (!done.ok) {
            const data = await done.json().catch(() => ({}));
            throw new Error(data.error ?? "Falha ao concluir o envio");
          }
          setError("");
          await load(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Falha no envio");
        } finally {
          setUploading((u) => u.filter((n, i) => i !== u.indexOf(file.name)));
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

  async function destroy() {
    if (!confirm("Apagar esta sala e todos os arquivos agora?")) return;
    await fetch(`/api/rooms/${id}`, { method: "DELETE" });
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

  if (phase === "password") {
    return (
      <main className="wrap">
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void join(password);
          }}
        >
          <h1>Sala protegida</h1>
          <p className="sub">Digite a senha para entrar.</p>
          <label htmlFor="pw">Senha</label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="primary block">Entrar</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="topbar">
        <h1><Link href="/" style={{ color: "inherit", textDecoration: "none" }}>Transfer2U</Link></h1>
        <span className="timer" aria-live="off">Expira em {fmtRemaining(expiresAt - now)}</span>
      </div>

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
              <button className="danger" onClick={destroy}>Apagar sala</button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Mensagens</h2>
        <div className="messages" ref={listRef}>
          {messages.length === 0 && <p className="empty">Nenhuma mensagem ainda.</p>}
          {messages.map((m) => (
            <div className="msg" key={m.id}>
              <button className="copy" onClick={() => copy(m.text, `m${m.id}`)}>
                {copied === `m${m.id}` ? "Copiado" : "Copiar"}
              </button>
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
          {uploading.map((name, i) => (
            <li key={`up${i}`}><span className="name">{name}</span><span className="size">enviando…</span></li>
          ))}
          {files.map((f) => (
            <li key={f.id}>
              <div className="name">
                {f.name}
                <div className="size">{fmtSize(f.size)} · {fmtTime(f.at)}</div>
              </div>
              <a className="btn" href={`/api/rooms/${id}/files/${f.id}`}>Baixar</a>
            </li>
          ))}
        </ul>
        {files.length === 0 && uploading.length === 0 && <p className="empty">Nenhum arquivo ainda.</p>}
      </section>

      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
