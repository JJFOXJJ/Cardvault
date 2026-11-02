/** Shown instantly while the next screen loads, so taps always get a response. */
export default function Loading() {
  return (
    <div className="loading-screen" role="status" aria-label="Loading">
      <div className="top"><div className="wrap"><span className="brand"><span className="brand-mark" aria-hidden /> Card Vault</span></div></div>
      <main className="wrap">
        <div className="skel skel-title" />
        <div className="skel skel-line" />
        <div className="skel-grid">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel skel-card" />)}
        </div>
      </main>
    </div>
  );
}
