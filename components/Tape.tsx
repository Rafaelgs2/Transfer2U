import Link from "next/link";

/** The paper strip every screen is printed on. `torn` drops the printer slot: a piece ripped off. */
export function Tape({ children, torn = false }: { children: React.ReactNode; torn?: boolean }) {
  return (
    <div className="tape-wrap">
      {torn ? <div className="tear tear-top" aria-hidden="true" /> : <div className="slot" aria-hidden="true" />}
      <div className="tape">{children}</div>
      <div className="tear" aria-hidden="true" />
    </div>
  );
}

export function Wordmark() {
  return <Link className="wordmark" href="/">Transfer<span>2U</span></Link>;
}
