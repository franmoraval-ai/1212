-- Ejecutar en Supabase SQL Editor para crear la tabla de puestos nacionales

CREATE TABLE IF NOT EXISTS public.puestos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  region text,
  province text,
  lng float NOT NULL,
  lat float NOT NULL,
  jefe_puesto text,
  phone text,
  visitas_count int DEFAULT 0,
  estado text DEFAULT 'Activo',
  tipo text DEFAULT 'Puesto',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.puestos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.puestos;
DROP POLICY IF EXISTS puestos_select_authenticated ON public.puestos;
DROP POLICY IF EXISTS puestos_insert_manager ON public.puestos;
DROP POLICY IF EXISTS puestos_update_manager ON public.puestos;
DROP POLICY IF EXISTS puestos_delete_director ON public.puestos;
CREATE POLICY puestos_select_authenticated ON public.puestos FOR SELECT TO authenticated USING ((SELECT auth.role()) = 'authenticated');
CREATE POLICY puestos_insert_manager ON public.puestos FOR INSERT TO authenticated WITH CHECK (public.app_is_active_user() AND public.app_is_role(3));
CREATE POLICY puestos_update_manager ON public.puestos FOR UPDATE TO authenticated USING (public.app_is_active_user() AND public.app_is_role(3)) WITH CHECK (public.app_is_active_user() AND public.app_is_role(3));
CREATE POLICY puestos_delete_director ON public.puestos FOR DELETE TO authenticated USING (public.app_is_active_user() AND public.app_is_role(4));

-- Insertar puestos de Costa Rica (principales)
INSERT INTO public.puestos (name, region, province, lng, lat, jefe_puesto, tipo, estado) VALUES
  ('HQ Central San José', 'Central', 'San José', -84.0934, 9.9281, 'Director', 'Cuartel General', 'Activo'),
  ('Puesto Cartago', 'Central', 'Cartago', -83.9234, 9.8581, 'Jefe Regional', 'Puesto Operativo', 'Activo'),
  ('Puesto Alajuela', 'Huetar Noroeste', 'Alajuela', -84.4869, 10.0160, 'Jefe Regional', 'Puesto Operativo', 'Activo'),
  ('Puesto Heredia', 'Central', 'Heredia', -84.1258, 10.0117, 'Jefe Regional', 'Puesto Operativo', 'Activo'),
  ('Puesto Limón', 'Huetar Caribe', 'Limón', -83.0340, 10.0063, 'Jefe Regional', 'Puesto Operativo', 'Activo'),
  ('Puesto San Isidro Pérez Zeledón', 'Brunca', 'Pérez Zeledón', -83.7364, 8.9906, 'Jefe Regional', 'Puesto Operativo', 'Activo'),
  ('Puesto Puntarenas', 'Pacífico Central', 'Puntarenas', -84.7584, 10.0145, 'Jefe Regional', 'Puesto Operativo', 'Activo'),
  ('Puesto Liberia', 'Pacífico Noroeste', 'Guanacaste', -85.4377, 10.6356, 'Jefe Regional', 'Puesto Operativo', 'Activo');

-- Crear tabla para registrar visitas a puestos
CREATE TABLE IF NOT EXISTS public.visitas_puestos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puesto_id uuid REFERENCES public.puestos(id) ON DELETE CASCADE,
  officer_name text,
  officer_id text,
  entrada timestamptz DEFAULT now(),
  salida timestamptz,
  motivo text,
  observaciones text,
  created_at timestamptz DEFAULT now()
);

-- Habilitar RLS en visitas
ALTER TABLE public.visitas_puestos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for authenticated" ON public.visitas_puestos;
DROP POLICY IF EXISTS visitas_puestos_select_scoped ON public.visitas_puestos;
DROP POLICY IF EXISTS visitas_puestos_insert_owner ON public.visitas_puestos;
DROP POLICY IF EXISTS visitas_puestos_update_supervisor ON public.visitas_puestos;
DROP POLICY IF EXISTS visitas_puestos_delete_supervisor ON public.visitas_puestos;
CREATE POLICY visitas_puestos_select_scoped ON public.visitas_puestos FOR SELECT TO authenticated USING (public.app_is_active_user() AND (public.app_is_role(2) OR public.app_matches_current_user(officer_id)));
CREATE POLICY visitas_puestos_insert_owner ON public.visitas_puestos FOR INSERT TO authenticated WITH CHECK (public.app_is_active_user() AND public.app_matches_current_user(officer_id));
CREATE POLICY visitas_puestos_update_supervisor ON public.visitas_puestos FOR UPDATE TO authenticated USING (public.app_is_active_user() AND public.app_is_role(2)) WITH CHECK (public.app_is_active_user() AND public.app_is_role(2));
CREATE POLICY visitas_puestos_delete_supervisor ON public.visitas_puestos FOR DELETE TO authenticated USING (public.app_is_active_user() AND public.app_is_role(2));

-- Crear trigger para actualizar contador de visitas
CREATE OR REPLACE FUNCTION update_visitas_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.puestos 
  SET visitas_count = (SELECT COUNT(*) FROM public.visitas_puestos WHERE puesto_id = NEW.puesto_id)
  WHERE id = NEW.puesto_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE TRIGGER trigger_update_visitas 
AFTER INSERT ON public.visitas_puestos
FOR EACH ROW
EXECUTE FUNCTION update_visitas_count();
