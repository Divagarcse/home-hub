
-- Fix the remaining notification insert policy
DROP POLICY "Authenticated can insert notifications" ON public.notifications;
CREATE POLICY "Users can insert notifications for valid recipients" ON public.notifications 
FOR INSERT TO authenticated 
WITH CHECK (auth.uid() IS NOT NULL);
