import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Wrench, ClipboardList, CheckCircle2, Upload } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import type { Tables, Database } from "@/integrations/supabase/types";

type Complaint = Tables<"complaints">;
type Status = Database["public"]["Enums"]["complaint_status"];

const navItems = [
  { title: "My Tasks", url: "/technician", icon: Wrench },
];

export default function TechnicianDashboard() {
  const { user } = useAuth();
  const [assignedTasks, setAssignedTasks] = useState<Complaint[]>([]);
  const [availableTasks, setAvailableTasks] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [completionPhoto, setCompletionPhoto] = useState<File | null>(null);

  const fetchTasks = async () => {
    if (!user) return;

    const [assignedRes, availableRes] = await Promise.all([
      supabase.from("complaints").select("*").eq("assigned_technician_id", user.id).order("created_at", { ascending: false }),
      supabase.from("complaints").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    ]);

    if (assignedRes.data) setAssignedTasks(assignedRes.data);
    if (availableRes.data) setAvailableTasks(availableRes.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();

    const channel = supabase
      .channel("tech-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => {
        fetchTasks();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const acceptTask = async (complaintId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("complaints")
      .update({ assigned_technician_id: user.id, status: "assigned" as Status })
      .eq("id", complaintId);

    if (error) {
      toast.error("Failed to accept task");
      return;
    }
    toast.success("Task accepted!");
  };

  const updateTaskStatus = async (complaint: Complaint, newStatus: Status) => {
    const updates: any = { status: newStatus };
    if (newStatus === "completed") {
      updates.completed_at = new Date().toISOString();
    }

    const { error } = await supabase.from("complaints").update(updates).eq("id", complaint.id);
    if (error) {
      toast.error("Failed to update status");
      return;
    }

    // Upload completion photo if provided
    if (newStatus === "completed" && completionPhoto) {
      const fileName = `${complaint.id}/completion-${Date.now()}-${completionPhoto.name}`;
      await supabase.storage.from("complaint-images").upload(fileName, completionPhoto);
      const { data: urlData } = supabase.storage.from("complaint-images").getPublicUrl(fileName);
      await supabase.from("complaint_images").insert({
        complaint_id: complaint.id,
        image_url: urlData.publicUrl,
      });
    }

    // Notify resident and admins
    if (newStatus === "completed") {
      await supabase.from("notifications").insert({
        user_id: complaint.resident_id,
        message: `Your complaint "${complaint.title}" has been resolved!`,
        complaint_id: complaint.id,
      });

      const { data: admins } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (admins) {
        const notifications = admins.map((a) => ({
          user_id: a.user_id,
          message: `Task completed: "${complaint.title}"`,
          complaint_id: complaint.id,
        }));
        await supabase.from("notifications").insert(notifications);
      }
    }

    toast.success(`Status updated to ${newStatus.replace("_", " ")}`);
    setRemarks("");
    setCompletionPhoto(null);
  };

  const activeTasks = assignedTasks.filter((t) => t.status !== "completed");
  const completedTasks = assignedTasks.filter((t) => t.status === "completed");

  return (
    <DashboardLayout navItems={navItems} roleLabel="Technician">
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold">My Tasks</h1>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
                <Wrench className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{activeTasks.length}</p>
                <p className="text-sm text-muted-foreground">Active Tasks</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-success/15 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{completedTasks.length}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-warning/15 flex items-center justify-center">
                <ClipboardList className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-display font-bold">{availableTasks.length}</p>
                <p className="text-sm text-muted-foreground">Available</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Active Tasks */}
        <Card>
          <CardHeader><CardTitle className="font-display">Assigned Tasks</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {activeTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No active tasks</p>
            ) : (
              activeTasks.map((task) => (
                <div key={task.id} className="p-4 rounded-lg border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {task.category.replace("_", " ")} · Block {task.block} · Room {task.room_number}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <PriorityBadge priority={task.priority} />
                      <StatusBadge status={task.status} />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{task.description}</p>
                  <div className="flex gap-2">
                    {task.status === "assigned" && (
                      <Button size="sm" onClick={() => updateTaskStatus(task, "in_progress")}>
                        Start Work
                      </Button>
                    )}
                    {(task.status === "assigned" || task.status === "in_progress") && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle className="font-display">Complete Task</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <p className="text-sm font-medium mb-2">Completion Photo (optional)</p>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => setCompletionPhoto(e.target.files?.[0] || null)}
                                className="text-sm"
                              />
                            </div>
                            <Button className="w-full" onClick={() => updateTaskStatus(task, "completed")}>
                              Mark as Completed
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Available Tasks */}
        <Card>
          <CardHeader><CardTitle className="font-display">Available Tasks</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {availableTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No available tasks</p>
            ) : (
              availableTasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{task.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {task.category.replace("_", " ")} · Block {task.block} · {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <PriorityBadge priority={task.priority} />
                    <Button size="sm" onClick={() => acceptTask(task.id)}>Accept</Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
