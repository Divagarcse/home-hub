
-- Fix all RLS policies: change from RESTRICTIVE to PERMISSIVE

-- complaints table
DROP POLICY IF EXISTS "Admins can update complaints" ON public.complaints;
DROP POLICY IF EXISTS "Admins can view all complaints" ON public.complaints;
DROP POLICY IF EXISTS "Residents can create complaints" ON public.complaints;
DROP POLICY IF EXISTS "Residents can view own complaints" ON public.complaints;
DROP POLICY IF EXISTS "Technicians can update assigned complaints" ON public.complaints;
DROP POLICY IF EXISTS "Technicians can view assigned complaints" ON public.complaints;
DROP POLICY IF EXISTS "Technicians can view unassigned in dept" ON public.complaints;

CREATE POLICY "Admins can view all complaints" ON public.complaints FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Residents can view own complaints" ON public.complaints FOR SELECT TO authenticated USING (auth.uid() = resident_id);
CREATE POLICY "Technicians can view assigned complaints" ON public.complaints FOR SELECT TO authenticated USING (auth.uid() = assigned_technician_id);
CREATE POLICY "Technicians can view unassigned" ON public.complaints FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'technician') AND status = 'pending');
CREATE POLICY "Residents can create complaints" ON public.complaints FOR INSERT TO authenticated WITH CHECK (auth.uid() = resident_id);
CREATE POLICY "Admins can update complaints" ON public.complaints FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Technicians can update assigned complaints" ON public.complaints FOR UPDATE TO authenticated USING (auth.uid() = assigned_technician_id);

-- complaint_images table
DROP POLICY IF EXISTS "Anyone authenticated can view complaint images" ON public.complaint_images;
DROP POLICY IF EXISTS "Users can insert images for own complaints" ON public.complaint_images;

CREATE POLICY "Anyone authenticated can view complaint images" ON public.complaint_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can insert images for own complaints" ON public.complaint_images FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_images.complaint_id AND c.resident_id = auth.uid())
  OR public.has_role(auth.uid(), 'technician')
);

-- notifications table
DROP POLICY IF EXISTS "Users can insert notifications for valid recipients" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;

CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- profiles table
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- user_roles table
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;

CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can insert own role" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Add SLA and third-party columns to complaints
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS sla_deadline timestamptz;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS third_party_name text;
ALTER TABLE public.complaints ADD COLUMN IF NOT EXISTS third_party_contact text;

-- Create internal_notes table
CREATE TABLE IF NOT EXISTS public.internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and technicians can view notes" ON public.internal_notes FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'technician')
);
CREATE POLICY "Admins and technicians can insert notes" ON public.internal_notes FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = author_id AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'technician'))
);

-- Create head_requests table for head approval system
CREATE TABLE IF NOT EXISTS public.head_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

ALTER TABLE public.head_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own request" ON public.head_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own request" ON public.head_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all requests" ON public.head_requests FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update requests" ON public.head_requests FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger for handle_new_user if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  END IF;
END;
$$;

-- Create trigger for updated_at on complaints if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_complaints_updated_at'
  ) THEN
    CREATE TRIGGER update_complaints_updated_at
      BEFORE UPDATE ON public.complaints
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END;
$$;

-- Enable realtime for notifications and complaints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'complaints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
  END IF;
END;
$$;

-- Add validation trigger for head_requests status
CREATE OR REPLACE FUNCTION public.validate_head_request_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'validate_head_request_status_trigger'
  ) THEN
    CREATE TRIGGER validate_head_request_status_trigger
      BEFORE INSERT OR UPDATE ON public.head_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.validate_head_request_status();
  END IF;
END;
$$;
