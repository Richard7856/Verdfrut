-- Tipos enumerados. Mantener sincronizados con packages/types/src/domain/*

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'dispatcher', 'zone_manager', 'driver');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_status AS ENUM ('available', 'in_route', 'maintenance', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE route_status AS ENUM (
    'DRAFT', 'OPTIMIZED', 'APPROVED', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stop_status AS ENUM ('pending', 'arrived', 'completed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_type AS ENUM ('entrega', 'tienda_cerrada', 'bascula');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM (
    'draft', 'submitted', 'resolved_by_driver', 'timed_out', 'completed', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE resolution_type AS ENUM ('completa', 'parcial', 'sin_entrega', 'timed_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE message_sender AS ENUM ('driver', 'zone_manager', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
