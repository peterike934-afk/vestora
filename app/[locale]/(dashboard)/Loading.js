import { LoadingScreen } from "@/components/LoadingLogo";

// Next.js shows this automatically while a dashboard route segment is
// loading data (e.g. server components fetching), before the real
// page content is ready to paint. There's no page behind it yet, so
// this uses the solid centered version rather than the blur overlay.
export default function Loading() {
  return <LoadingScreen />;
}