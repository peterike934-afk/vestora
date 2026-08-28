// Real Vestora "V" mark — same paths used across the marketing
// Navbar/Footer, the dashboard sidebar, and auth pages (login/signup).
// Standalone, no badge/box around it — just the mark itself, colored
// with the brand green so it reads clearly on both light and dark
// backgrounds.
export default function VestoraMark({ size = 22 }) {
  const width = size;
  const height = (size * 30) / 27;
  return (
    <svg width={width} height={height} viewBox="0 0 27 30" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M2 4L11 24L20 4" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 12L20 4L25 9" stroke="var(--green)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}