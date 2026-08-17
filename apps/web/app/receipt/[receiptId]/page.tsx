import { ReceiptView } from "../../_components/receipt-view";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  readonly params: Promise<{ receiptId: string }>;
}) {
  const { receiptId } = await params;
  return <ReceiptView receiptId={receiptId} />;
}
