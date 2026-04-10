import "./Layout.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div id="page-container">
      <div id="page-content">
        {children}
      </div>
    </div>
  );
}