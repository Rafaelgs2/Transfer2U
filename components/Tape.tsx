import Link from "next/link";

/**
 * The paper strip every screen is printed on. It feeds out of the printer slot when it appears;
 * `torn` drops the slot and lands instead (a piece ripped off); `still` skips the entrance.
 */
export function Tape({
  children,
  torn = false,
  still = false,
}: {
  children: React.ReactNode;
  torn?: boolean;
  still?: boolean;
}) {
  const entrance = still ? "" : torn ? " landing" : " feed";
  return (
    <div className={`tape-wrap${entrance}`}>
      {torn ? <div className="tear tear-top" aria-hidden="true" /> : <div className="slot" aria-hidden="true" />}
      <div className="tape">{children}</div>
      <div className="tear" aria-hidden="true" />
    </div>
  );
}

export function Wordmark() {
  return <Link className="wordmark" href="/">Transfer<span>2U</span></Link>;
}
