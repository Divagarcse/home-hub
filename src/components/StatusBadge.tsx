import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type Status = Database["public"]["Enums"]["complaint_status"];
type Priority = Database["public"]["Enums"]["complaint_priority"];

const statusMap: Record<Status | "overdue", { label: string; className: string }> = {
  pending: { label: "Pending", className: "status-badge-pending" },
  assigned: { label: "Assigned", className: "status-badge-assigned" },
  in_progress: { label: "In Progress", className: "status-badge-in-progress" },
  completed: { label: "Completed", className: "status-badge-completed" },
  overdue: { label: "Overdue", className: "bg-destructive/15 text-destructive border border-destructive/30" },
};

const priorityMap: Record<Priority, { label: string; className: string }> = {
  low: { label: "Low", className: "priority-badge-low" },
  medium: { label: "Medium", className: "priority-badge-medium" },
  high: { label: "High", className: "priority-badge-high" },
};

export function StatusBadge({ status, isOverdue }: { status: Status; isOverdue?: boolean }) {
  const displayStatus = isOverdue && status !== "completed" ? "overdue" : status;
  const config = statusMap[displayStatus];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", config.className)}>
      {config.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const config = priorityMap[priority];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", config.className)}>
      {config.label}
    </span>
  );
}
