"use client";
import { useParams, useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { uploadPresigned as blobUpload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Tape, Wordmark } from "@/components/Tape";
import { saveName, savedName } from "@/lib/client-name";

type Message = { id: string; text: string; at: number; by: string; mine: boolean };
type FileItem = { id: string; name: string; size: number; at: number; by: string; mine: boolean; image: boolean };
type Upload = { key: string; name: string; pct: number; preview?: string };
type Phase = "loading" | "join" | "gone" | "ready";

const MAX_BYTES = 50 * 1024 * 1024;
const POLL_MS = 4000;
const PREVIEW_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];

// Warnings as the room nears its end: a slip on the tape first, a coupon for the last stretch.
const WARNINGS = [
  { ms: 3_600_000, label: "1 hora", popup: false },
  { ms: 600_000, label: "10 minutos", popup: false },
  { ms: 300_000, label: "5 minutos", popup: true },
  { ms: 60_000, label: "1 minuto", popup: true },
];

// Blob pathnames are built from this, so keep it to safe characters.
const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-100) || "arquivo";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

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
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const [popup, setPopup] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const version = useRef<number | null>(null);
  const known = useRef<Set<string> | null>(null);
  const warned = useRef<Set<number> | null>(null);
  const followEnd = useRef(true);

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

    // Only what arrived after the room opened gets the printing animation.
    const ids: string[] = [...data.messages, ...data.files].map((x: { id: string }) => x.id);
    const seen = known.current;
    setFresh(new Set(seen ? ids.filter((x) => !seen.has(x)) : []));
    known.current = new Set(ids);

    setExpiresAt(new Date(data.expiresAt).getTime());
    setMe(data.me);
    setIsOwner(data.isOwner);
    setRoomCode(data.code);
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

  // Messages and files are one receipt, in the order they arrived.
  const items = useMemo(
    () =>
      [
        ...messages.map((m) => ({ kind: "msg" as const, ...m })),
        ...files.map((f) => ({ kind: "file" as const, ...f })),
      ].sort((a, b) => a.at - b.at),
    [messages, files],
  );

  // Stay at the end of the tape only if that's where the reader already is.
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      followEnd.current = window.innerHeight + window.scrollY >= el.scrollHeight - 200;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (followEnd.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [items.length, uploads.length, phase]);

  async function send() {
    const value = text.trim();
    if (!value) return;
    setText("");
    followEnd.current = true;
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
      followEnd.current = true;
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

  // The whole window is the drop target. The depth counter ignores enter/leave from child elements.
  useEffect(() => {
    if (phase !== "ready") return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void upload(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
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
    return (
      <main className="stage">
        <Tape><p style={{ paddingBottom: 12 }}>Abrindo a sala…</p></Tape>
      </main>
    );
  }

  if (phase === "gone") {
    return (
      <main className="stage">
        <Tape torn>
          <Wordmark />
          <h1 className="code" style={{ fontSize: "clamp(1.7rem, 8vw, 2.4rem)", marginTop: 18 }}>Esta via expirou</h1>
          <p style={{ marginTop: 12 }}>O link está errado, ou a sala acabou e tudo foi apagado.</p>
          <Link className="btn btn-solid btn-wide" href="/">Criar nova sala</Link>
          <div style={{ height: 12 }} />
        </Tape>
      </main>
    );
  }

  if (phase === "join") {
    return (
      <main className="stage">
        <Tape>
          <Wordmark />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void join(nameInput, password);
            }}
          >
            <h1 className="section-title" style={{ marginTop: 18, fontSize: 22 }}>Entrar na sala</h1>

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
            <p className="hint">É assim que os outros vão ver você.</p>

            {hasPassword && (
              <>
                <label htmlFor="pw">Senha da sala</label>
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

            <button className="btn btn-solid btn-wide" disabled={joining}>{joining ? "Entrando…" : "Entrar"}</button>
            {joinError && <p className="error" role="alert">{joinError}</p>}
            <div style={{ height: 12 }} />
          </form>
        </Tape>
      </main>
    );
  }

  const remaining = expiresAt - now;

  const validity = (
    <span className={`valid${remaining < 300_000 ? " soon" : ""}`}>válido por {fmtRemaining(remaining)}</span>
  );
  const shareNote = (
    <p className="head-note">
      {roomCode && link
        ? `Para outro aparelho ou outra pessoa: digite o código em ${new URL(link).host}, leia o QR ou envie o link.`
        : "Para outro aparelho ou outra pessoa: leia o QR ou envie o link."}
    </p>
  );
  const shareActs = (
    <div className="share-acts">
      {roomCode && (
        <button className="act act-solid" onClick={() => copy(roomCode, "code")}>
          {copied === "code" ? "código copiado" : "copiar código"}
        </button>
      )}
      <button className={`act${roomCode ? "" : " act-solid act-wide"}`} onClick={() => copy(link, "link")}>
        {copied === "link" ? "link copiado" : "copiar link"}
      </button>
      {isOwner && <button className="act act-wide" onClick={destroy}>apagar sala</button>}
    </div>
  );
  const qr = (size: number) =>
    link && (
      <div className="qr" role="img" aria-label="QR code do link da sala">
        <QRCodeSVG value={link} size={size} bgColor="#fffdf7" fgColor="#111111" />
      </div>
    );

  return (
    <main className="stage stage-room">
      {/* Wide screens only: a second strip beside the chat, lined up with it top and bottom. */}
      <aside className="side">
        <div className="slot" aria-hidden="true" />
        <div className="stub">
          <Wordmark />
          <div className="stub-code">
            <div className="stub-row">
              <span className="stub-label">código da sala</span>
              <span>você: {me}</span>
            </div>
            {roomCode && <div className="code">{roomCode}</div>}
          </div>
          {qr(280)}
          {shareNote}
          {shareActs}
        </div>
        <div className="tear" aria-hidden="true" />
        <div className={`side-time${remaining < 300_000 ? " soon" : ""}`}>
          <span>válido por</span>
          <strong>{fmtRemaining(remaining)}</strong>
        </div>
      </aside>

      <div className="room-col">
      <Tape>
        <div className="tape-head">
          <header>
            <div className="head-top">
              <Wordmark />
              {validity}
            </div>
            <div className="head-main">
              {roomCode && <div className="code">{roomCode}</div>}
              {qr(92)}
            </div>
            {shareNote}
            {shareActs}
          </header>

          <hr className="rule" style={{ marginBottom: 0 }} />
        </div>

        {notice && (
          <div className="slip" role="status">
            <span>{notice}</span>
            <button className="act" onClick={() => setNotice("")}>fechar</button>
          </div>
        )}

        <ul className="items">
          {items.length === 0 && uploads.length === 0 && (
            <li className="empty">Nada impresso ainda. Escreva abaixo, anexe ou solte um arquivo aqui.</li>
          )}

          {items.map((it) => (
            <li className={`item${fresh.has(it.id) ? " fresh" : ""}`} key={it.id}>
              <div className="item-head">
                <span>
                  {fmtTime(it.at)} <span className={`who${it.mine ? " mine" : ""}`}>{it.by}{it.mine ? " (você)" : ""}</span>
                </span>
                <span className="acts">
                  {it.kind === "msg" ? (
                    <button className="act" onClick={() => copy(it.text, `m${it.id}`)} aria-label={`Copiar mensagem de ${it.by}`}>
                      {copied === `m${it.id}` ? "copiado" : "copiar"}
                    </button>
                  ) : (
                    <a className="act act-solid" href={`/api/rooms/${id}/files/${it.id}`} aria-label={`Baixar ${it.name}`}>baixar</a>
                  )}
                  {(it.mine || isOwner) && (
                    <button
                      className="act"
                      aria-label={it.kind === "msg" ? `Apagar mensagem de ${it.by}` : `Apagar ${it.name}`}
                      onClick={() => (it.kind === "msg" ? removeMessage(it) : removeFile(it))}
                    >
                      apagar
                    </button>
                  )}
                </span>
              </div>

              {it.kind === "msg" ? (
                <p className="item-text">{it.text}</p>
              ) : (
                <>
                  <div className="leader">
                    <span className="name">{it.name}</span>
                    <span className="dots" aria-hidden="true" />
                    <span className="size">{fmtSize(it.size)}</span>
                  </div>
                  {it.image && (
                    <a className="photo" href={`/api/rooms/${id}/files/${it.id}?inline=1`} target="_blank" rel="noopener">
                      <img
                        src={`/api/rooms/${id}/files/${it.id}?inline=1`}
                        alt={`Prévia de ${it.name}`}
                        loading="lazy"
                        onLoad={() => {
                          // Its height is only known now, so the tape just grew.
                          if (followEnd.current) window.scrollTo({ top: document.documentElement.scrollHeight });
                        }}
                      />
                    </a>
                  )}
                </>
              )}
            </li>
          ))}

          {uploads.map((u) => (
            <li className="item" key={u.key}>
              <div className="item-head">
                <span>imprimindo…</span>
                <span>{u.pct}%</span>
              </div>
              <div className="leader"><span className="name">{u.name}</span></div>
              <progress max={100} value={u.pct} aria-label={`Enviando ${u.name}`} />
              {u.preview && <span className="photo"><img src={u.preview} alt="" /></span>}
            </li>
          ))}
        </ul>

        <div className="total">
          <span>total</span>
          <span className="dots" aria-hidden="true" />
          <span>{items.length} {items.length === 1 ? "item" : "itens"}</span>
        </div>
      </Tape>

      <div className="bar">
        <div className="bar-inner">
          {error && <p className="bar-error" role="alert">{error}</p>}
          <div className="bar-row">
            <button className="btn" onClick={() => fileInput.current?.click()}>anexar</button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void upload(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <textarea
              rows={1}
              value={text}
              maxLength={4000}
              placeholder="Escrever"
              aria-label="Mensagem"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn btn-send" onClick={() => void send()}>enviar</button>
          </div>
        </div>
      </div>
      </div>

      {dragging && <div className="dropzone">Solte para imprimir</div>}

      <dialog ref={dialogRef} className="coupon" onClose={() => setPopup("")} aria-labelledby="coupon-title">
        <div className="coupon-inner">
          <h2 id="coupon-title">A sala está acabando</h2>
          <p>{popup}</p>
          <form method="dialog">
            <button className="btn">Entendi</button>
          </form>
        </div>
      </dialog>
    </main>
  );
}
