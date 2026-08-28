import { Suspense } from "react";
import { Signup } from "@/components/Auth";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <Signup />
    </Suspense>
  );
}