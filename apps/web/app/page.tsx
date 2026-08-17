import { SigningWorkflow } from "./_components/signing-workflow";
import { loadWebBootstrap } from "@web/lib/server-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const bootstrap = await loadWebBootstrap();
  return <SigningWorkflow bootstrap={bootstrap} />;
}
