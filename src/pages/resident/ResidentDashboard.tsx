import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";

type Complaint = Tables<"complaints">;

const navItems = [
  { title: "Dashboard", url: "/resident", icon: ClipboardList },
  { title: "New Complaint", url: "/resident/new", icon: Plus },
];

export default function ResidentDashboard() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetchComplaints = async () => {
      const { data } = await supabase
        .from("complaints")
        .select("*")
        .eq("resident_id", user.id)
        .order("created_at", { ascending: false });
      if (data) setComplaints(data);
      setLoading(false);
    };
    fetchComplaints();

    // Real-time
    const channel = supabase
      .channel("resident-complaints")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints", filter: `resident_id=eq.${user.id}` }, () => {
        fetchComplaints();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const pending = complaints.filter((c) => c.status === "pending").length;
  const inProgress = complaints.filter((c) => c.status === "in_progress" || c.status === "assigned").length;
  const completed = complaints.filter((c) => c.status === "completed").length;

  return (
    <DashboardLayout navItems={navItems} roleLabel="Resident">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display font-bold text-foreground">My Dashboard</h1>
          <Link to="/resident/new">
            <Button className="gap-2"><Plus className="h-4 w-4" /> New Complaint</Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-warning/15 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{pending}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{inProgress}</p>
                <p className="text-sm text-muted-foreground">In Progress</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-success/15 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{completed}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Complaints list */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display">My Complaints</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : complaints.length === 0 ? (
              <p className="text-muted-foreground text-sm py-8 text-center">No complaints yet. Submit your first one!</p>
            ) : (
              <div className="space-y-3">
                {complaints.map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{c.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {c.category.replace("_", " ")} · Block {c.block} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <PriorityBadge priority={c.priority} />
                      <StatusBadge status={c.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
