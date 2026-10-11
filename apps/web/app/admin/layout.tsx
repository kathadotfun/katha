// Operations pages share the ink header (chosen by route) and paper workspace.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ops-main">
      <div className="wrap">{children}</div>
    </div>
  );
}
