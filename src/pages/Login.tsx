import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Building2, User, Shield, Wrench } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];
type TechDepartment = Database["public"]["Enums"]["tech_department"];

const roleConfig: Record<AppRole, { icon: typeof User; label: string }> = {
  resident: { icon: User, label: "Resident" },
  admin: { icon: Shield, label: "Apartment Head" },
  technician: { icon: Wrench, label: "Technician" },
};

export default function Login() {
  const navigate = useNavigate();
  const { user, role, loading: authLoading } = useAuth();
  const [activeRole, setActiveRole] = useState<AppRole>("resident");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [contact, setContact] = useState("");
  const [block, setBlock] = useState("");
  const [room, setRoom] = useState("");
  const [floor, setFloor] = useState("");
  const [department, setDepartment] = useState<TechDepartment>("general");

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user && role) {
      navigate(`/${role}`, { replace: true });
    }
  }, [user, role, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Fetch role to verify
      const { data: roleData } = await supabase.rpc("get_user_role", { _user_id: data.user.id });
      if (roleData !== activeRole) {
        await supabase.auth.signOut();
        toast.error(`This account is not registered as ${roleConfig[activeRole].label}`);
        return;
      }

      toast.success("Login successful!");
      navigate(`/${activeRole}`, { replace: true });
    } catch (err: any) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      if (!data.user) throw new Error("Signup failed");

      // Set role
      const { error: roleError } = await supabase.from("user_roles").insert({
        user_id: data.user.id,
        role: activeRole,
      });
      if (roleError) throw roleError;

      // Update profile
      const profileUpdate: Record<string, string | null> = {
        contact_number: contact || null,
        block_number: block || null,
      };
      if (activeRole === "resident") {
        profileUpdate.room_number = room || null;
        profileUpdate.floor_number = floor || null;
      }
      if (activeRole === "technician") {
        profileUpdate.department = department;
      }

      await supabase.from("profiles").update(profileUpdate).eq("user_id", data.user.id);

      toast.success("Account created! Please check your email to verify, then log in.");
      setIsSignUp(false);
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Building2 className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold font-display text-foreground">MaintainX</h1>
          </div>
          <p className="text-muted-foreground">Apartment Maintenance Management</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-display">
              {isSignUp ? "Create Account" : "Sign In"}
            </CardTitle>
            <CardDescription>Select your role to continue</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={activeRole} onValueChange={(v) => setActiveRole(v as AppRole)}>
              <TabsList className="grid w-full grid-cols-3">
                {(["resident", "admin", "technician"] as AppRole[]).map((r) => {
                  const Icon = roleConfig[r].icon;
                  return (
                    <TabsTrigger key={r} value={r} className="gap-1 text-xs">
                      <Icon className="h-3.5 w-3.5" />
                      {roleConfig[r].label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>

            <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-3">
              {isSignUp && (
                <div>
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
              )}

              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>

              {isSignUp && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="contact">Contact</Label>
                      <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="block">Block</Label>
                      <Input id="block" value={block} onChange={(e) => setBlock(e.target.value)} />
                    </div>
                  </div>

                  {activeRole === "resident" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="room">Room Number</Label>
                        <Input id="room" value={room} onChange={(e) => setRoom(e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor="floor">Floor</Label>
                        <Input id="floor" value={floor} onChange={(e) => setFloor(e.target.value)} />
                      </div>
                    </div>
                  )}

                  {activeRole === "technician" && (
                    <div>
                      <Label>Department</Label>
                      <Select value={department} onValueChange={(v) => setDepartment(v as TechDepartment)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="electrician">Electrician</SelectItem>
                          <SelectItem value="plumbing">Plumbing</SelectItem>
                          <SelectItem value="lift">Lift</SelectItem>
                          <SelectItem value="garbage">Garbage</SelectItem>
                          <SelectItem value="security">Security</SelectItem>
                          <SelectItem value="general">General</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
              </Button>
            </form>

            <div className="text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline"
                onClick={() => setIsSignUp(!isSignUp)}
              >
                {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
