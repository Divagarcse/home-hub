import { useEffect, useState } from "react";
import { differenceInSeconds, differenceInHours, differenceInMinutes } from "date-fns";

interface SlaCountdownProps {
  deadline: string;
  status: string;
}

export function SlaCountdown({ deadline, status }: SlaCountdownProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (status === "completed") return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [status]);

  if (status === "completed") {
    return <span className="text-xs text-success font-medium">Completed</span>;
  }

  const deadlineDate = new Date(deadline);
  const totalSeconds = differenceInSeconds(deadlineDate, now);
  const isOverdue = totalSeconds <= 0;

  if (isOverdue) {
    const overdueMins = Math.abs(differenceInMinutes(deadlineDate, now));
    const hrs = Math.floor(overdueMins / 60);
    const mins = overdueMins % 60;
    return (
      <span className="text-xs font-bold text-destructive animate-pulse">
        ⚠ Overdue by {hrs > 0 ? `${hrs}h ` : ""}{mins}m
      </span>
    );
  }

  const hours = differenceInHours(deadlineDate, now);
  const minutes = differenceInMinutes(deadlineDate, now) % 60;
  const seconds = totalSeconds % 60;

  const urgencyClass = hours < 2 ? "text-destructive" : hours < 8 ? "text-warning" : "text-muted-foreground";

  return (
    <span className={`text-xs font-mono font-medium ${urgencyClass}`}>
      {hours}h {minutes}m {seconds}s
    </span>
  );
}

export function isOverdue(deadline: string | null, status: string): boolean {
  if (!deadline || status === "completed") return false;
  return new Date(deadline) < new Date();
}
