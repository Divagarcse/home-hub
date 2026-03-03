import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ClipboardList, Plus, Upload, X } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Category = Database["public"]["Enums"]["complaint_category"];
type Priority = Database["public"]["Enums"]["complaint_priority"];

const navItems = [
  { title: "Dashboard", url: "/resident", icon: ClipboardList },
  { title: "New Complaint", url: "/resident/new", icon: Plus },
];

const categories: { value: Category; label: string }[] = [
  { value: "electricity", label: "Electricity" },
  { value: "garbage", label: "Garbage" },
  { value: "lift", label: "Lift" },
  { value: "plumbing", label: "Plumbing" },
  { value: "security_issue", label: "Security Issue" },
  { value: "personnel_issue", label: "Personnel Issue" },
  { value: "other", label: "Other" },
];

export default function NewComplaint() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("other");
  const [landmark, setLandmark] = useState("");
  const [block, setBlock] = useState(profile?.block_number || "");
  const [roomNumber, setRoomNumber] = useState(profile?.room_number || "");
  const [priority, setPriority] = useState<Priority>("medium");

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setImages((prev) => [...prev, ...newFiles].slice(0, 5));
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      // Create complaint
      const { data: complaint, error } = await supabase
        .from("complaints")
        .insert({
          resident_id: user.id,
          category,
          title,
          description,
          landmark: landmark || null,
          block,
          room_number: roomNumber,
          priority,
        })
        .select()
        .single();

      if (error) throw error;

      // Upload images
      for (const file of images) {
        const fileName = `${complaint.id}/${Date.now()}-${file.name}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("complaint-images")
          .upload(fileName, file);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        const { data: urlData } = supabase.storage.from("complaint-images").getPublicUrl(fileName);

        await supabase.from("complaint_images").insert({
          complaint_id: complaint.id,
          image_url: urlData.publicUrl,
        });
      }

      // Notify admins
      const { data: admins } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      if (admins) {
        const notifications = admins.map((a) => ({
          user_id: a.user_id,
          message: `New complaint: "${title}" from Block ${block}`,
          complaint_id: complaint.id,
        }));
        await supabase.from("notifications").insert(notifications);
      }

      toast.success("Complaint submitted successfully!");
      navigate("/resident");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit complaint");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout navItems={navItems} roleLabel="Resident">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-display font-bold text-foreground mb-6">Submit New Complaint</h1>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Category</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="title">Title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required rows={4} maxLength={2000} />
              </div>

              <div>
                <Label htmlFor="landmark">Landmark</Label>
                <Input id="landmark" value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder="Near elevator, parking lot, etc." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="block">Block</Label>
                  <Input id="block" value={block} onChange={(e) => setBlock(e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="room">Room Number</Label>
                  <Input id="room" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} required />
                </div>
              </div>

              {/* Image upload */}
              <div>
                <Label>Photos (max 5)</Label>
                <div className="mt-2 border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">Drop images here or click to browse</p>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageChange}
                    className="hidden"
                    id="image-upload"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("image-upload")?.click()}>
                    Choose Files
                  </Button>
                </div>
                {images.length > 0 && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {images.map((file, i) => (
                      <div key={i} className="relative group">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={`Preview ${i + 1}`}
                          className="h-16 w-16 rounded-md object-cover border border-border"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Submitting..." : "Submit Complaint"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
