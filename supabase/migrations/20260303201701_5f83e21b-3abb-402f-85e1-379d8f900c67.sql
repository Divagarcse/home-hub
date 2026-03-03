
-- Create enum for roles
CREATE TYPE public.app_role AS ENUM ('resident', 'admin', 'technician');

-- Create enum for complaint categories
CREATE TYPE public.complaint_category AS ENUM ('electricity', 'garbage', 'lift', 'plumbing', 'security_issue', 'personnel_issue', 'other');

-- Create enum for complaint priority
CREATE TYPE public.complaint_priority AS ENUM ('low', 'medium', 'high');

-- Create enum for complaint status
CREATE TYPE public.complaint_status AS ENUM ('pending', 'assigned', 'in_progress', 'completed');

-- Create enum for technician department
CREATE TYPE public.tech_department AS ENUM ('electrician', 'plumbing', 'lift', 'garbage', 'security', 'general');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  contact_number TEXT,
  block_number TEXT,
  room_number TEXT,
  floor_number TEXT,
  department tech_department,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- Create complaints table
CREATE TABLE public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category complaint_category NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  landmark TEXT,
  block TEXT NOT NULL,
  room_number TEXT NOT NULL,
  priority complaint_priority NOT NULL DEFAULT 'medium',
  status complaint_status NOT NULL DEFAULT 'pending',
  assigned_technician_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create complaint_images table
CREATE TABLE public.complaint_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  complaint_id UUID REFERENCES public.complaints(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaint_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- User roles policies
CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own role" ON public.user_roles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Complaints policies
CREATE POLICY "Residents can view own complaints" ON public.complaints FOR SELECT USING (auth.uid() = resident_id);
CREATE POLICY "Residents can create complaints" ON public.complaints FOR INSERT WITH CHECK (auth.uid() = resident_id);
CREATE POLICY "Admins can view all complaints" ON public.complaints FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update complaints" ON public.complaints FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Technicians can view assigned complaints" ON public.complaints FOR SELECT USING (auth.uid() = assigned_technician_id);
CREATE POLICY "Technicians can view unassigned in dept" ON public.complaints FOR SELECT USING (
  public.has_role(auth.uid(), 'technician') AND status = 'pending'
);
CREATE POLICY "Technicians can update assigned complaints" ON public.complaints FOR UPDATE USING (auth.uid() = assigned_technician_id);

-- Complaint images policies
CREATE POLICY "Anyone authenticated can view complaint images" ON public.complaint_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert images" ON public.complaint_images FOR INSERT TO authenticated WITH CHECK (true);

-- Notifications policies
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Authenticated can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_complaints_updated_at BEFORE UPDATE ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create handle_new_user function to auto-create profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Storage bucket for complaint images
INSERT INTO storage.buckets (id, name, public) VALUES ('complaint-images', 'complaint-images', true);

CREATE POLICY "Anyone can view complaint images" ON storage.objects FOR SELECT USING (bucket_id = 'complaint-images');
CREATE POLICY "Authenticated users can upload complaint images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'complaint-images');
