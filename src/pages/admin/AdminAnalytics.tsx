import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard, ClipboardList, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { Tables } from "@/integrations/supabase/types";

type Complaint = Tables<"complaints">;

const navItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "All Complaints", url: "/admin/complaints", icon: ClipboardList },
  { title: "Analytics", url: "/admin/analytics", icon: BarChart3 },
];

const COLORS = ["hsl(220, 72%, 50%)", "hsl(152, 60%, 42%)", "hsl(38, 92%, 50%)", "hsl(0, 84%, 60%)", "hsl(200, 80%, 50%)", "hsl(280, 60%, 50%)", "hsl(160, 40%, 50%)"];

export default function AdminAnalytics() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);

  useEffect(() => {
    supabase.from("complaints").select("*").then(({ data }) => {
      if (data) setComplaints(data);
    });
  }, []);

  // By category
  const categoryData = Object.entries(
    complaints.reduce((acc, c) => {
      acc[c.category] = (acc[c.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: name.replace("_", " "), value }));

  // By status
  const statusData = Object.entries(
    complaints.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: name.replace("_", " "), value }));

  // By block
  const blockData = Object.entries(
    complaints.reduce((acc, c) => {
      acc[c.block] = (acc[c.block] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name: `Block ${name}`, value }));

  // Avg resolution time
  const completedComplaints = complaints.filter((c) => c.completed_at);
  const avgResolution = completedComplaints.length
    ? Math.round(
        completedComplaints.reduce((sum, c) => {
          return sum + (new Date(c.completed_at!).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60);
        }, 0) / completedComplaints.length
      )
    : 0;

  return (
    <DashboardLayout navItems={navItems} roleLabel="Apartment Head">
      <div className="space-y-6">
        <h1 className="text-2xl font-display font-bold">Analytics</h1>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-display font-bold text-primary">{complaints.length}</p>
              <p className="text-sm text-muted-foreground">Total Complaints</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-display font-bold text-success">{completedComplaints.length}</p>
              <p className="text-sm text-muted-foreground">Resolved</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-display font-bold text-warning">{avgResolution}h</p>
              <p className="text-sm text-muted-foreground">Avg Resolution Time</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="font-display text-base">By Category</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={categoryData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="font-display text-base">Status Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="font-display text-base">By Block</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={blockData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
