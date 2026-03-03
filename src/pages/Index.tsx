import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Building2, ArrowRight, Shield, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export default function Index() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && role) {
      navigate(`/${role}`);
    }
  }, [user, role, loading, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="text-center space-y-6 animate-fade-in max-w-lg">
        <div className="flex items-center justify-center gap-3">
          <Building2 className="h-12 w-12 text-primary" />
          <h1 className="text-5xl font-display font-bold text-foreground">MaintainX</h1>
        </div>
        <p className="text-lg text-muted-foreground">
          Smart apartment maintenance management. Report issues, track repairs, stay informed.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
          <div className="p-4 rounded-xl border border-border bg-card text-center space-y-2">
            <User className="h-8 w-8 mx-auto text-primary" />
            <h3 className="font-display font-semibold">Residents</h3>
            <p className="text-xs text-muted-foreground">Report & track maintenance issues</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card text-center space-y-2">
            <Shield className="h-8 w-8 mx-auto text-warning" />
            <h3 className="font-display font-semibold">Admin</h3>
            <p className="text-xs text-muted-foreground">Manage complaints & assign tasks</p>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card text-center space-y-2">
            <Wrench className="h-8 w-8 mx-auto text-success" />
            <h3 className="font-display font-semibold">Technicians</h3>
            <p className="text-xs text-muted-foreground">Accept & resolve maintenance tasks</p>
          </div>
        </div>

        <Link to="/login">
          <Button size="lg" className="gap-2 mt-4">
            Get Started <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
