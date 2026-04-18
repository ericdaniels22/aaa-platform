import "./public.css";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="public-scope">{children}</div>;
}
