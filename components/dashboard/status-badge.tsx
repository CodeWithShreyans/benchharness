import { Badge } from "@/components/ui/badge";
import type { CellStatus, RunStatus } from "@/lib/benchmarks/types";

type Props = {
  status: RunStatus | CellStatus;
};

export function StatusBadge({ status }: Props) {
  if (status === "completed") {
    return <Badge variant="success">completed</Badge>;
  }

  if (status === "failed" || status === "canceled") {
    return <Badge variant="danger">{status}</Badge>;
  }

  if (status === "running" || status === "starting") {
    return <Badge variant="warning">{status}</Badge>;
  }

  return <Badge variant="outline">{status}</Badge>;
}
