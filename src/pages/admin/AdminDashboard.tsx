import { useEffect, useState, useMemo } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, ClipboardList, BarChart3, AlertTriangle, CheckCircle2, Clock, Search, FileDown, UserCheck, UserX, Eye } from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import type { Tables, Database } from "@/integrations/supabase/types";
import jsPDF from "jspdf";
import "jspdf-autotable";

type Complaint = Tables<"complaints"> & {
  sla_deadline?: string | null;
  third_party_name?: string | null;
  third_party_contact?: string | null;
};
type Profile = Tables<"profiles">;
type Status = Database["public"]["Enums"]["complaint_status"];

const navItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [images, setImages] = useState<Record<string, string[]>>({});
  const [technicians, setTechnicians] = useState<(Profile & { userId: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"latest" | "oldest" | "sla">("latest");
  const [headRequests, setHeadRequests] = useState<any[]>([]);
  const [headRequestProfiles, setHeadRequestProfiles] = useState<Record<string, Profile>>({});
  const [notes, setNotes] = useState<Record<string, any[]>>({});
  const [newNote, setNewNote] = useState("");
  const [activeTab, setActiveTab] = useState("complaints");

  // Assignment dialog state
  const [assignType, setAssignType] = useState<"technician" | "third_party">("technician");
  const [thirdPartyName, setThirdPartyName] = useState("");
  const [thirdPartyContact, setThirdPartyContact] = useState("");
  const [slaHours, setSlaHours] = useState("24");
  const [selectedComplaintId, setSelectedComplaintId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [complaintsRes, techRolesRes, headReqRes] = await Promise.all([
        supabase.from("complaints").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id").eq("role", "technician"),
        supabase.from("head_requests" as any).select("*").order("created_at", { ascending: false }),
      ]);

      const complaintsData = (complaintsRes.data || []) as Complaint[];
      setComplaints(complaintsData);

      // Fetch head requests
      if (headReqRes.data) setHeadRequests(headReqRes.data);

      // Fetch all resident profiles
      const residentIds = [...new Set(complaintsData.map(c => c.resident_id))];
      const headReqUserIds = (headReqRes.data || []).map((r: any) => r.user_id);
      const allUserIds = [...new Set([...residentIds, ...headReqUserIds])];
      
      if (allUserIds.length > 0) {
        const { data: profilesData } = await supabase.from("profiles").select("*").in("user_id", allUserIds);
        if (profilesData) {
          const map: Record<string, Profile> = {};
          profilesData.forEach(p => { map[p.user_id] = p; });
          setProfiles(map);
          // Also for head requests
          const hrMap: Record<string, Profile> = {};
          headReqUserIds.forEach((uid: string) => { if (map[uid]) hrMap[uid] = map[uid]; });
          setHeadRequestProfiles(hrMap);
        }
      }

      // Fetch images for all complaints
      const complaintIds = complaintsData.map(c => c.id);
      if (complaintIds.length > 0) {
        const { data: imagesData } = await supabase.from("complaint_images").select("*").in("complaint_id", complaintIds);
        if (imagesData) {
          const imgMap: Record<string, string[]> = {};
          imagesData.forEach(img => {
            if (!imgMap[img.complaint_id]) imgMap[img.complaint_id] = [];
            imgMap[img.complaint_id].push(img.image_url);
          });
          setImages(imgMap);
        }
      }

      // Fetch technicians
      if (techRolesRes.data && techRolesRes.data.length > 0) {
        const techIds = techRolesRes.data.map(r => r.user_id);
        const { data: techProfiles } = await supabase.from("profiles").select("*").in("user_id", techIds);
        if (techProfiles) {
          setTechnicians(techProfiles.map(p => ({ ...p, userId: p.user_id })));
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel("admin-complaints")
      .on("postgres_changes", { event: "*", schema: "public", table: "complaints" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchNotes = async (complaintId: string) => {
    const { data } = await supabase.from("internal_notes" as any).select("*").eq("complaint_id", complaintId).order("created_at", { ascending: false });
    if (data) {
      setNotes(prev => ({ ...prev, [complaintId]: data }));
    }
  };

  const addNote = async (complaintId: string) => {
    if (!newNote.trim() || !user) return;
    const { error } = await supabase.from("internal_notes" as any).insert({
      complaint_id: complaintId,
      author_id: user.id,
      note: newNote.trim(),
    });
    if (error) { toast.error("Failed to add note"); return; }
    toast.success("Note added");
    setNewNote("");
    fetchNotes(complaintId);
  };

  const assignTechnician = async (complaintId: string, techId: string) => {
    const slaDeadline = new Date(Date.now() + parseInt(slaHours) * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("complaints")
      .update({
        assigned_technician_id: techId,
        status: "assigned" as Status,
        sla_deadline: slaDeadline,
        third_party_name: null,
        third_party_contact: null,
      } as any)
      .eq("id", complaintId);

    if (error) { toast.error("Failed to assign"); return; }

    const complaint = complaints.find(c => c.id === complaintId);
    await supabase.from("notifications").insert({
      user_id: techId,
      message: `New task assigned: "${complaint?.title}"`,
      complaint_id: complaintId,
    });

    toast.success("Technician assigned!");
    setSelectedComplaintId(null);
  };

  const assignThirdParty = async (complaintId: string) => {
    if (!thirdPartyName.trim()) { toast.error("Enter third-party name"); return; }
    const slaDeadline = new Date(Date.now() + parseInt(slaHours) * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("complaints")
      .update({
        status: "assigned" as Status,
        sla_deadline: slaDeadline,
        third_party_name: thirdPartyName,
        third_party_contact: thirdPartyContact || null,
        assigned_technician_id: null,
      } as any)
      .eq("id", complaintId);

    if (error) { toast.error("Failed to assign"); return; }
    toast.success("Third-party assigned!");
    setThirdPartyName("");
    setThirdPartyContact("");
    setSelectedComplaintId(null);
  };

  const updateStatus = async (complaintId: string, status: Status) => {
    const updates: any = { status };
    if (status === "completed") updates.completed_at = new Date().toISOString();
    const { error } = await supabase.from("complaints").update(updates).eq("id", complaintId);
    if (error) { toast.error("Failed to update"); return; }
    toast.success("Status updated");
  };

  const approveHeadRequest = async (requestId: string, userId: string) => {
    const { error: roleError } = await supabase.from("user_roles").insert({ user_id: userId, role: "admin" as any });
    if (roleError && !roleError.message.includes("duplicate")) { toast.error("Failed to set role"); return; }
    await supabase.from("head_requests" as any).update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: user?.id }).eq("id", requestId);
    toast.success("Request approved");
    fetchData();
  };

  const rejectHeadRequest = async (requestId: string) => {
    await supabase.from("head_requests" as any).update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: user?.id }).eq("id", requestId);
    toast.success("Request rejected");
    fetchData();
  };

  const filtered = useMemo(() => {
    let result = complaints.filter(c => {
      if (filterStatus !== "all") {
        if (filterStatus === "overdue") {
          if (!isOverdue((c as any).sla_deadline, c.status)) return false;
        } else if (c.status !== filterStatus) return false;
      }
      if (filterCategory !== "all" && c.category !== filterCategory) return false;
      if (filterPriority !== "all" && c.priority !== filterPriority) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const residentName = profiles[c.resident_id]?.full_name?.toLowerCase() || "";
        if (!c.title.toLowerCase().includes(q) && !residentName.includes(q)) return false;
      }
      return true;
    });

    result.sort((a, b) => {
      if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === "sla") {
        const aDeadline = (a as any).sla_deadline ? new Date((a as any).sla_deadline).getTime() : Infinity;
        const bDeadline = (b as any).sla_deadline ? new Date((b as any).sla_deadline).getTime() : Infinity;
        return aDeadline - bDeadline;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [complaints, filterStatus, filterCategory, filterPriority, searchQuery, sortBy, profiles]);

  const pending = complaints.filter(c => c.status === "pending").length;
  const active = complaints.filter(c => c.status === "assigned" || c.status === "in_progress").length;
  const completed = complaints.filter(c => c.status === "completed").length;
  const overdueCount = complaints.filter(c => isOverdue((c as any).sla_deadline, c.status)).length;

  const exportPdf = (complaintsToExport: Complaint[]) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("MaintainX - Complaints Report", 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${format(new Date(), "PPpp")}`, 14, 30);

    const tableData = complaintsToExport.map(c => [
      c.title,
      profiles[c.resident_id]?.full_name || "N/A",
      c.category.replace("_", " "),
      c.priority,
      c.status.replace("_", " "),
      c.block,
      format(new Date(c.created_at), "PP"),
      (c as any).sla_deadline ? format(new Date((c as any).sla_deadline), "PP HH:mm") : "N/A",
      technicians.find(t => t.userId === c.assigned_technician_id)?.full_name || (c as any).third_party_name || "Unassigned",
    ]);

    (doc as any).autoTable({
      head: [["Title", "Resident", "Category", "Priority", "Status", "Block", "Created", "SLA", "Assigned To"]],
      body: tableData,
      startY: 36,
      styles: { fontSize: 7 },
      headStyles: { fillColor: [59, 130, 246] },
    });

    doc.save(`complaints-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    toast.success("PDF exported!");
  };

  const exportSinglePdf = (c: Complaint) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Complaint Report", 14, 22);
    doc.setFontSize(11);
    let y = 36;
    const addLine = (label: string, value: string) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${label}:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(value, 60, y);
      y += 8;
    };
    addLine("Title", c.title);
    addLine("Resident", profiles[c.resident_id]?.full_name || "N/A");
    addLine("Category", c.category.replace("_", " "));
    addLine("Priority", c.priority);
    addLine("Status", c.status.replace("_", " "));
    addLine("Block / Room", `${c.block} / ${c.room_number}`);
    addLine("Landmark", c.landmark || "N/A");
    addLine("Created", format(new Date(c.created_at), "PPpp"));
    addLine("Updated", format(new Date(c.updated_at), "PPpp"));
    addLine("SLA Deadline", (c as any).sla_deadline ? format(new Date((c as any).sla_deadline), "PPpp") : "N/A");
    const assignedName = technicians.find(t => t.userId === c.assigned_technician_id)?.full_name || (c as any).third_party_name || "Unassigned";
    addLine("Assigned To", assignedName);
    if (c.completed_at) addLine("Completed", format(new Date(c.completed_at), "PPpp"));
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.text("Description:", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const descLines = doc.splitTextToSize(c.description, 170);
    doc.text(descLines, 14, y);

    doc.save(`complaint-${c.id.slice(0, 8)}.pdf`);
    toast.success("PDF exported!");
  };

  return (
    <DashboardLayout navItems={navItems} roleLabel="Apartment Head">
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-display font-bold">Admin Dashboard</h1>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => exportPdf(filtered)}>
            <FileDown className="h-4 w-4" /> Export PDF
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total", value: complaints.length, icon: ClipboardList, color: "bg-primary/15 text-primary" },
            { label: "Pending", value: pending, icon: AlertTriangle, color: "bg-warning/15 text-warning" },
            { label: "Active", value: active, icon: Clock, color: "bg-info/15 text-info" },
            { label: "Completed", value: completed, icon: CheckCircle2, color: "bg-success/15 text-success" },
            { label: "Overdue", value: overdueCount, icon: AlertTriangle, color: "bg-destructive/15 text-destructive" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3 flex items-center gap-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${s.color.split(" ")[0]}`}>
                  <s.icon className={`h-4 w-4 ${s.color.split(" ")[1]}`} />
                </div>
                <div>
                  <p className="text-xl font-display font-bold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="complaints">All Complaints</TabsTrigger>
            <TabsTrigger value="head_requests">Head Requests {headRequests.filter(r => r.status === "pending").length > 0 && `(${headRequests.filter(r => r.status === "pending").length})`}</TabsTrigger>
          </TabsList>

          <TabsContent value="complaints" className="space-y-4 mt-4">
            {/* Filters */}
            <div className="flex gap-2 flex-wrap items-center">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by title or resident..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
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
              <Select value={filterPriority} onValueChange={setFilterPriority}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={v => setSortBy(v as any)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="sla">SLA Deadline</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Complaint</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Resident</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Priority</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">SLA</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Assigned</th>
                        <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(c => {
                        const overdue = isOverdue((c as any).sla_deadline, c.status);
                        return (
                          <tr key={c.id} className={`border-b border-border hover:bg-muted/30 transition-colors ${overdue ? "bg-destructive/5" : ""}`}>
                            <td className="px-4 py-3">
                              <p className="font-medium">{c.title}</p>
                              <p className="text-xs text-muted-foreground">{c.category.replace("_", " ")} · Block {c.block}</p>
                              <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</p>
                            </td>
                            <td className="px-4 py-3 text-sm">{profiles[c.resident_id]?.full_name || "—"}</td>
                            <td className="px-4 py-3"><PriorityBadge priority={c.priority} /></td>
                            <td className="px-4 py-3"><StatusBadge status={c.status} isOverdue={overdue} /></td>
                            <td className="px-4 py-3">
                              {(c as any).sla_deadline ? <SlaCountdown deadline={(c as any).sla_deadline} status={c.status} /> : <span className="text-xs text-muted-foreground">—</span>}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {c.assigned_technician_id
                                ? technicians.find(t => t.userId === c.assigned_technician_id)?.full_name || "Technician"
                                : (c as any).third_party_name || <span className="text-muted-foreground">Unassigned</span>}
                            </td>
                            <td className="px-4 py-3">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="gap-1" onClick={() => { setSelectedComplaintId(c.id); fetchNotes(c.id); }}>
                                    <Eye className="h-3.5 w-3.5" /> Manage
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                                  <DialogHeader>
                                    <DialogTitle className="font-display">{c.title}</DialogTitle>
                                  </DialogHeader>
                                  <ComplaintDetail
                                    complaint={c}
                                    profile={profiles[c.resident_id]}
                                    images={images[c.id] || []}
                                    technicians={technicians}
                                    notes={notes[c.id] || []}
                                    profiles={profiles}
                                    newNote={newNote}
                                    setNewNote={setNewNote}
                                    onAddNote={() => addNote(c.id)}
                                    onAssignTech={(techId) => assignTechnician(c.id, techId)}
                                    onAssignThirdParty={() => assignThirdParty(c.id)}
                                    onUpdateStatus={(status) => updateStatus(c.id, status)}
                                    onExportPdf={() => exportSinglePdf(c)}
                                    assignType={assignType}
                                    setAssignType={setAssignType}
                                    thirdPartyName={thirdPartyName}
                                    setThirdPartyName={setThirdPartyName}
                                    thirdPartyContact={thirdPartyContact}
                                    setThirdPartyContact={setThirdPartyContact}
                                    slaHours={slaHours}
                                    setSlaHours={setSlaHours}
                                  />
                                </DialogContent>
                              </Dialog>
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No complaints found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="head_requests" className="space-y-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="font-display text-base">Pending Head Requests</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {headRequests.filter(r => r.status === "pending").length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No pending requests</p>
                ) : (
                  headRequests.filter(r => r.status === "pending").map(req => (
                    <div key={req.id} className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div>
                        <p className="font-medium">{headRequestProfiles[req.user_id]?.full_name || "Unknown User"}</p>
                        <p className="text-xs text-muted-foreground">
                          {headRequestProfiles[req.user_id]?.contact_number || "No contact"} · {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1" onClick={() => approveHeadRequest(req.id, req.user_id)}>
                          <UserCheck className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" className="gap-1" onClick={() => rejectHeadRequest(req.id)}>
                          <UserX className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  ))
                )}

                {headRequests.filter(r => r.status !== "pending").length > 0 && (
                  <>
                    <h3 className="text-sm font-medium text-muted-foreground pt-4">History</h3>
                    {headRequests.filter(r => r.status !== "pending").map(req => (
                      <div key={req.id} className="flex items-center justify-between p-3 rounded-lg border border-border opacity-70">
                        <div>
                          <p className="text-sm">{headRequestProfiles[req.user_id]?.full_name || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(req.created_at), "PP")}</p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${req.status === "approved" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                          {req.status}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// Complaint detail sub-component
function ComplaintDetail({
  complaint: c, profile, images, technicians, notes, profiles, newNote, setNewNote,
  onAddNote, onAssignTech, onAssignThirdParty, onUpdateStatus, onExportPdf,
  assignType, setAssignType, thirdPartyName, setThirdPartyName, thirdPartyContact, setThirdPartyContact,
  slaHours, setSlaHours,
}: any) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const overdue = isOverdue(c.sla_deadline, c.status);

  return (
    <div className="space-y-4">
      {/* Info grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-muted-foreground">Resident:</span> {profile?.full_name || "N/A"}</div>
        <div><span className="text-muted-foreground">Category:</span> {c.category.replace("_", " ")}</div>
        <div><span className="text-muted-foreground">Block / Room:</span> {c.block} / {c.room_number}</div>
        <div><span className="text-muted-foreground">Landmark:</span> {c.landmark || "N/A"}</div>
        <div><span className="text-muted-foreground">Created:</span> {format(new Date(c.created_at), "PPpp")}</div>
        <div><span className="text-muted-foreground">Updated:</span> {format(new Date(c.updated_at), "PPpp")}</div>
        <div className="flex items-center gap-2"><span className="text-muted-foreground">Priority:</span> <PriorityBadge priority={c.priority} /></div>
        <div className="flex items-center gap-2"><span className="text-muted-foreground">Status:</span> <StatusBadge status={c.status} isOverdue={overdue} /></div>
        {c.sla_deadline && (
          <div className="col-span-2 flex items-center gap-2">
            <span className="text-muted-foreground">SLA:</span>
            <SlaCountdown deadline={c.sla_deadline} status={c.status} />
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Description</p>
        <p className="text-sm text-muted-foreground">{c.description}</p>
      </div>

      {/* Images */}
      {images.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Photos</p>
          <div className="flex gap-2 flex-wrap">
            {images.map((url: string, i: number) => (
              <img key={i} src={url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-md object-cover border border-border cursor-pointer hover:opacity-80"
                onClick={() => setPreviewImage(url)} />
            ))}
          </div>
        </div>
      )}

      {/* Image preview modal */}
      {previewImage && (
        <Dialog open onOpenChange={() => setPreviewImage(null)}>
          <DialogContent className="max-w-lg">
            <img src={previewImage} alt="Preview" className="w-full rounded-md" />
          </DialogContent>
        </Dialog>
      )}

      {/* Assignment */}
      {c.status !== "completed" && (
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-sm font-medium">{c.assigned_technician_id || c.third_party_name ? "Reassign" : "Assign"}</p>
          
          <div className="flex gap-2 items-center">
            <Label className="text-xs">SLA (hours):</Label>
            <Input type="number" value={slaHours} onChange={e => setSlaHours(e.target.value)} className="w-24 h-8" min="1" />
          </div>

          <Tabs value={assignType} onValueChange={v => setAssignType(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="technician" className="text-xs h-7">Technician</TabsTrigger>
              <TabsTrigger value="third_party" className="text-xs h-7">Third-Party</TabsTrigger>
            </TabsList>
            <TabsContent value="technician" className="mt-2">
              {technicians.length === 0 ? (
                <p className="text-sm text-muted-foreground">No technicians available</p>
              ) : (
                <div className="space-y-1">
                  {technicians.map((t: any) => (
                    <Button key={t.userId} variant="outline" size="sm" className="w-full justify-start text-xs"
                      onClick={() => onAssignTech(t.userId)}>
                      {t.full_name}
                    </Button>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="third_party" className="mt-2 space-y-2">
              <Input placeholder="Name" value={thirdPartyName} onChange={e => setThirdPartyName(e.target.value)} className="h-8" />
              <Input placeholder="Contact" value={thirdPartyContact} onChange={e => setThirdPartyContact(e.target.value)} className="h-8" />
              <Button size="sm" onClick={onAssignThirdParty}>Assign Third-Party</Button>
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Status update */}
      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium mb-2">Update Status</p>
        <Select value={c.status} onValueChange={onUpdateStatus}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Internal notes */}
      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium mb-2">Internal Notes</p>
        <div className="space-y-2 max-h-40 overflow-y-auto mb-3">
          {notes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No notes yet</p>
          ) : (
            notes.map((n: any) => (
              <div key={n.id} className="p-2 rounded bg-muted text-sm">
                <p>{n.note}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {profiles[n.author_id]?.full_name || "Unknown"} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} className="h-8" />
          <Button size="sm" onClick={onAddNote}>Add</Button>
        </div>
      </div>

      {/* Export */}
      <div className="border-t border-border pt-4">
        <Button variant="outline" size="sm" className="gap-1" onClick={onExportPdf}>
          <FileDown className="h-3.5 w-3.5" /> Export as PDF
        </Button>
      </div>
    </div>
  );
}
