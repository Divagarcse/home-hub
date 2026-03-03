import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LayoutDashboard, ClipboardList, BarChart3, AlertTriangle, CheckCircle2, Clock, Users } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Tables, Database } from "@/integrations/supabase/types";
import { Link } from "react-router-dom";

type Complaint = Tables<"complaints">;
type Profile = Tables<"profiles">;
type Status = Database["public"]["Enums"]["complaint_status"];

const navItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "All Complaints", url: "/admin/complaints", icon: ClipboardList },
  { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
];

export default function AdminDashboard() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [technicians, setTechnicians] = useState<(Profile & { userId: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);

  const fetchData = async () => {
    const [complaintsRes, techRolesRes] = await Promise.all([
      supabase.from("complaints").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id").eq("role", "technician"),
    ]);

    if (complaintsRes.data) setComplaints(complaintsRes.data);

    if (techRolesRes.data && techRolesRes.data.length > 0) {
      const techIds = techRolesRes.data.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", techIds);
      if (profiles) {
        setTechnicians(profiles.map((p) => ({ ...p, userId: p.user_id })));
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();

    const channel = supabase
      .channel("admin-complaints")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => {
        fetchData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const assignTechnician = async (complaintId: string, techId: string) => {
    const { error } = await supabase
      .from("complaints")
      .update({ assigned_technician_id: techId, status: "assigned" as Status })
      .eq("id", complaintId);

    if (error) {
      toast.error("Failed to assign technician");
      return;
    }

    // Notify technician
    const complaint = complaints.find((c) => c.id === complaintId);
    await supabase.from("notifications").insert({
      user_id: techId,
      message: `New task assigned: "${complaint?.title}"`,
      complaint_id: complaintId,
    });

    toast.success("Technician assigned!");
    setSelectedComplaint(null);
  };

  const updateStatus = async (complaintId: string, status: Status) => {
    const updates: any = { status };
    if (status === "completed") updates.completed_at = new Date().toISOString();

    await supabase.from("complaints").update(updates).eq("id", complaintId);
    toast.success("Status updated");
  };

  const filtered = complaints.filter((c) => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    return true;
  });

  const pending = complaints.filter((c) => c.status === "pending").length;
  const active = complaints.filter((c) => c.status === "assigned" || c.status === "in_progress").length;
  const completed = complaints.filter((c) => c.status === "completed").length;

  return (
    <DashboardLayout navItems={navItems} roleLabel="Apartment Head">
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold">Admin Dashboard</h1>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{complaints.length}</p>
                <p className="text-sm text-muted-foreground">Total</p>
              </div>
            </CardContent>
          </Card>
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
              <div className="h-10 w-10 rounded-lg bg-info/15 flex items-center justify-center">
                <Clock className="h-5 w-5 text-info" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{active}</p>
                <p className="text-sm text-muted-foreground">Active</p>
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

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="electricity">Electricity</SelectItem>
              <SelectItem value="garbage">Garbage</SelectItem>
              <SelectItem value="lift">Lift</SelectItem>
              <SelectItem value="plumbing">Plumbing</SelectItem>
              <SelectItem value="security_issue">Security</SelectItem>
              <SelectItem value="personnel_issue">Personnel</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Complaints Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Block</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Priority</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium">{c.title}</p>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</p>
                      </td>
                      <td className="px-4 py-3 capitalize">{c.category.replace("_", " ")}</td>
                      <td className="px-4 py-3">{c.block}</td>
                      <td className="px-4 py-3"><PriorityBadge priority={c.priority} /></td>
                      <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-4 py-3">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm" onClick={() => setSelectedComplaint(c)}>
                              Manage
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="font-display">{c.title}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <p className="text-sm">{c.description}</p>
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <p><span className="text-muted-foreground">Category:</span> {c.category.replace("_", " ")}</p>
                                <p><span className="text-muted-foreground">Block:</span> {c.block}</p>
                                <p><span className="text-muted-foreground">Room:</span> {c.room_number}</p>
                                <p><span className="text-muted-foreground">Landmark:</span> {c.landmark || "N/A"}</p>
                              </div>

                              {/* Assign technician */}
                              {c.status === "pending" && technicians.length > 0 && (
                                <div>
                                  <p className="text-sm font-medium mb-2">Assign Technician</p>
                                  <div className="space-y-2">
                                    {technicians.map((t) => (
                                      <Button
                                        key={t.userId}
                                        variant="outline"
                                        size="sm"
                                        className="w-full justify-start"
                                        onClick={() => assignTechnician(c.id, t.userId)}
                                      >
                                        {t.full_name} ({t.department || "general"})
                                      </Button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Change status */}
                              <div>
                                <p className="text-sm font-medium mb-2">Update Status</p>
                                <Select value={c.status} onValueChange={(v) => updateStatus(c.id, v as Status)}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="assigned">Assigned</SelectItem>
                                    <SelectItem value="in_progress">In Progress</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No complaints found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
