
-- Fix overly permissive complaint_images insert policy
DROP POLICY "Authenticated users can insert images" ON public.complaint_images;
CREATE POLICY "Users can insert images for own complaints" ON public.complaint_images 
FOR INSERT TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.complaints c 
    WHERE c.id = complaint_id AND c.resident_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'technician')
);

-- Fix overly permissive storage insert policy  
DROP POLICY "Authenticated users can upload complaint images" ON storage.objects;
CREATE POLICY "Users can upload complaint images" ON storage.objects 
FOR INSERT TO authenticated 
WITH CHECK (bucket_id = 'complaint-images' AND auth.uid() IS NOT NULL);
