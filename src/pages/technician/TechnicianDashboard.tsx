import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatusBadge, PriorityBadge } from "@/components/StatusBadge";
import { SlaCountdown, isOverdue } from "@/components/SlaCountdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Wrench, ClipboardList, CheckCircle2, Upload, Eye } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import type { Tables, Database } from "@/integrations/supabase/types";

type Complaint = Tables<"complaints"> & {
  sla_deadline?: string | null;
};
type Status = Database["public"]["Enums"]["complaint_status"];

const navItems = [
  { title: "My Tasks", url: "/technician", icon: Wrench },
];

export default function TechnicianDashboard() {
  const { user } = useAuth();
  const [assignedTasks, setAssignedTasks] = useState<Complaint[]>([]);
  const [availableTasks, setAvailableTasks] = useState<Complaint[]>([]);
  const [images, setImages] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [completionPhoto, setCompletionPhoto] = useState<File | null>(null);
  const [completing, setCompleting] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [notes, setNotes] = useState<Record<string, any[]>>({});
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fetchTasks = async () => {
    if (!user) return;
    try {
      const [assignedRes, availableRes] = await Promise.all([
        supabase.from("complaints").select("*").eq("assigned_technician_id", user.id).order("created_at", { ascending: false }),
        supabase.from("complaints").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      ]);

      const assigned = (assignedRes.data || []) as Complaint[];
      const available = (availableRes.data || []) as Complaint[];
      setAssignedTasks(assigned);
      setAvailableTasks(available);

      // Fetch images for assigned tasks
      const ids = [...assigned, ...available].map(t => t.id);
      if (ids.length > 0) {
        const { data: imgData } = await supabase.from("complaint_images").select("*").in("complaint_id", ids);
        if (imgData) {
          const map: Record<string, string[]> = {};
          imgData.forEach(img => {
            if (!map[img.complaint_id]) map[img.complaint_id] = [];
            map[img.complaint_id].push(img.image_url);
          });
          setImages(map);
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
    const channel = supabase
      .channel("tech-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => fetchTasks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const fetchNotes = async (complaintId: string) => {
    const { data } = await supabase.from("internal_notes" as any).select("*").eq("complaint_id", complaintId).order("created_at", { ascending: false });
    if (data) setNotes(prev => ({ ...prev, [complaintId]: data }));
  };

  const addNote = async (complaintId: string) => {
    if (!newNote.trim() || !user) return;
    const { error } = await supabase.from("internal_notes" as any).insert({ complaint_id: complaintId, author_id: user.id, note: newNote.trim() });
    if (error) { toast.error("Failed to add note"); return; }
    toast.success("Note added");
    setNewNote("");
    fetchNotes(complaintId);
  };

  const acceptTask = async (complaintId: string) => {
    if (!user) return;
    const { error } = await supabase
      .from("complaints")
      .update({ assigned_technician_id: user.id, status: "assigned" as Status })
      .eq("id", complaintId);

    if (error) { toast.error("Failed to accept task"); return; }
    toast.success("Task accepted!");
  };

  const updateTaskStatus = async (complaint: Complaint, newStatus: Status) => {
    if (!user) return;

    // Require completion photo for marking completed
    if (newStatus === "completed" && !completionPhoto) {
      toast.error("Please upload a completion photo before marking as completed");
      return;
    }

    setCompleting(true);
    try {
      const updates: any = { status: newStatus };
      if (newStatus === "completed") updates.completed_at = new Date().toISOString();

      const { error } = await supabase.from("complaints").update(updates).eq("id", complaint.id);
      if (error) throw error;

      // Upload completion photo
      if (newStatus === "completed" && completionPhoto) {
        const fileName = `${complaint.id}/completion-${Date.now()}-${completionPhoto.name}`;
        const { error: uploadErr } = await supabase.storage.from("complaint-images").upload(fileName, completionPhoto);
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("complaint-images").getPublicUrl(fileName);
          await supabase.from("complaint_images").insert({
            complaint_id: complaint.id,
            image_url: urlData.publicUrl,
          });
        }
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
          const notifs = admins.map(a => ({
            user_id: a.user_id,
            message: `Task completed: "${complaint.title}"`,
            complaint_id: complaint.id,
          }));
          await supabase.from("notifications").insert(notifs);
        }
      }

      toast.success(`Status updated to ${newStatus.replace("_", " ")}`);
      setCompletionPhoto(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setCompleting(false);
    }
  };

  const activeTasks = assignedTasks.filter(t => t.status !== "completed");
  const completedTasks = assignedTasks.filter(t => t.status === "completed");

  const TaskCard = ({ task, showActions }: { task: Complaint; showActions: boolean }) => {
    const taskImages = images[task.id] || [];
    const overdue = isOverdue((task as any).sla_deadline, task.status);

    return (
      <div className={`p-4 rounded-lg border border-border space-y-3 ${overdue ? "border-destructive/50 bg-destructive/5" : ""}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{task.title}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {task.category.replace("_", " ")} · Block {task.block} · Room {task.room_number}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} isOverdue={overdue} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{task.description}</p>
        {task.landmark && <p className="text-xs text-muted-foreground">📍 {task.landmark}</p>}

        {(task as any).sla_deadline && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">SLA:</span>
            <SlaCountdown deadline={(task as any).sla_deadline} status={task.status} />
          </div>
        )}

        {/* Resident images */}
        {taskImages.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">Photos</p>
            <div className="flex gap-2 flex-wrap">
              {taskImages.map((url, i) => (
                <img key={i} src={url} alt={`Photo ${i + 1}`}
                  className="h-16 w-16 rounded-md object-cover border border-border cursor-pointer hover:opacity-80"
                  onClick={() => setPreviewImage(url)} />
              ))}
            </div>
          </div>
        )}

        {showActions && (
          <div className="flex gap-2 flex-wrap">
            {task.status === "assigned" && (
              <Button size="sm" onClick={() => updateTaskStatus(task, "in_progress")} disabled={completing}>
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
                      <Label className="text-sm font-medium">Completion Photo (required)</Label>
                      <div className="mt-2 border-2 border-dashed border-border rounded-lg p-4 text-center">
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                        <input type="file" accept="image/*" id={`completion-${task.id}`}
                          onChange={e => setCompletionPhoto(e.target.files?.[0] || null)} className="hidden" />
                        <Button type="button" variant="outline" size="sm"
                          onClick={() => document.getElementById(`completion-${task.id}`)?.click()}>
                          Choose Photo
                        </Button>
                        {completionPhoto && <p className="text-xs text-success mt-1">{completionPhoto.name}</p>}
                      </div>
                    </div>
                    <Button className="w-full" onClick={() => updateTaskStatus(task, "completed")} disabled={completing || !completionPhoto}>
                      {completing ? "Submitting..." : "Mark as Completed"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1" onClick={() => fetchNotes(task.id)}>
                  <Eye className="h-3.5 w-3.5" /> Notes
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-display">Internal Notes</DialogTitle></DialogHeader>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {(notes[task.id] || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
                  ) : (
                    (notes[task.id] || []).map((n: any) => (
                      <div key={n.id} className="p-2 rounded bg-muted text-sm">
                        <p>{n.note}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <Input placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} className="h-8" />
                  <Button size="sm" onClick={() => addNote(task.id)}>Add</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>
    );
  };

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
            ) : activeTasks.map(task => <TaskCard key={task.id} task={task} showActions />)}
          </CardContent>
        </Card>

        {/* Available Tasks */}
        <Card>
          <CardHeader><CardTitle className="font-display">Available Tasks</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {availableTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No available tasks</p>
            ) : availableTasks.map(task => (
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
            ))}
          </CardContent>
        </Card>

        {/* Completed Tasks */}
        {completedTasks.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="font-display text-muted-foreground">Completed</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {completedTasks.map(task => <TaskCard key={task.id} task={task} showActions={false} />)}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Image preview */}
      {previewImage && (
        <Dialog open onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-lg">
            <img src={previewImage} alt="Preview" className="w-full rounded-md" />
          </DialogContent>
        </Dialog>
      )}
    </DashboardLayout>
  );
}
