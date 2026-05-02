// AUTO-GENERATED — NO EDITAR A MANO.
// Generado desde el schema real del proyecto Supabase del tenant via MCP supabase__generate_typescript_types
// (o: pnpm dlx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID).
// Re-generar cuando se aplique cualquier migración nueva.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      delivery_reports: {
        Row: {
          created_at: string
          current_step: string
          driver_id: string
          evidence: Json
          has_merma: boolean
          id: string
          incident_details: Json
          metadata: Json
          no_ticket_reason: string | null
          no_ticket_reason_photo_url: string | null
          other_incident_description: string | null
          other_incident_photo_url: string | null
          partial_failure_items: Json | null
          resolution_type: Database["public"]["Enums"]["resolution_type"] | null
          resolved_at: string | null
          return_ticket_data: Json | null
          return_ticket_extraction_confirmed: boolean
          route_id: string
          status: Database["public"]["Enums"]["report_status"]
          stop_id: string
          store_code: string
          store_id: string
          store_name: string
          submitted_at: string | null
          ticket_data: Json | null
          ticket_extraction_confirmed: boolean
          ticket_image_url: string | null
          timeout_at: string | null
          type: Database["public"]["Enums"]["report_type"]
          zone_id: string
        }
        Insert: {
          created_at?: string
          current_step: string
          driver_id: string
          evidence?: Json
          has_merma?: boolean
          id?: string
          incident_details?: Json
          metadata?: Json
          no_ticket_reason?: string | null
          no_ticket_reason_photo_url?: string | null
          other_incident_description?: string | null
          other_incident_photo_url?: string | null
          partial_failure_items?: Json | null
          resolution_type?: Database["public"]["Enums"]["resolution_type"] | null
          resolved_at?: string | null
          return_ticket_data?: Json | null
          return_ticket_extraction_confirmed?: boolean
          route_id: string
          status?: Database["public"]["Enums"]["report_status"]
          stop_id: string
          store_code: string
          store_id: string
          store_name: string
          submitted_at?: string | null
          ticket_data?: Json | null
          ticket_extraction_confirmed?: boolean
          ticket_image_url?: string | null
          timeout_at?: string | null
          type: Database["public"]["Enums"]["report_type"]
          zone_id: string
        }
        Update: {
          created_at?: string
          current_step?: string
          driver_id?: string
          evidence?: Json
          has_merma?: boolean
          id?: string
          incident_details?: Json
          metadata?: Json
          no_ticket_reason?: string | null
          no_ticket_reason_photo_url?: string | null
          other_incident_description?: string | null
          other_incident_photo_url?: string | null
          partial_failure_items?: Json | null
          resolution_type?: Database["public"]["Enums"]["resolution_type"] | null
          resolved_at?: string | null
          return_ticket_data?: Json | null
          return_ticket_extraction_confirmed?: boolean
          route_id?: string
          status?: Database["public"]["Enums"]["report_status"]
          stop_id?: string
          store_code?: string
          store_id?: string
          store_name?: string
          submitted_at?: string | null
          ticket_data?: Json | null
          ticket_extraction_confirmed?: boolean
          ticket_image_url?: string | null
          timeout_at?: string | null
          type?: Database["public"]["Enums"]["report_type"]
          zone_id?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          license_expires_at: string | null
          license_number: string | null
          user_id: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          license_expires_at?: string | null
          license_number?: string | null
          user_id: string
          zone_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          license_expires_at?: string | null
          license_number?: string | null
          user_id?: string
          zone_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          report_id: string
          sender: Database["public"]["Enums"]["message_sender"]
          sender_user_id: string | null
          text: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          report_id: string
          sender: Database["public"]["Enums"]["message_sender"]
          sender_user_id?: string | null
          text?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          report_id?: string
          sender?: Database["public"]["Enums"]["message_sender"]
          sender_user_id?: string | null
          text?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
          zone_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
          zone_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      route_breadcrumbs: {
        Row: {
          driver_id: string
          heading: number | null
          id: string
          lat: number
          lng: number
          recorded_at: string
          route_id: string
          speed: number | null
        }
        Insert: {
          driver_id: string
          heading?: number | null
          id?: string
          lat: number
          lng: number
          recorded_at: string
          route_id: string
          speed?: number | null
        }
        Update: {
          driver_id?: string
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          route_id?: string
          speed?: number | null
        }
        Relationships: []
      }
      route_versions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          reason: string
          route_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          reason: string
          route_id: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          route_id?: string
          version?: number
        }
        Relationships: []
      }
      routes: {
        Row: {
          actual_end_at: string | null
          actual_start_at: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          date: string
          driver_id: string | null
          estimated_end_at: string | null
          estimated_start_at: string | null
          id: string
          name: string
          published_at: string | null
          published_by: string | null
          status: Database["public"]["Enums"]["route_status"]
          total_distance_meters: number | null
          total_duration_seconds: number | null
          updated_at: string
          vehicle_id: string
          version: number
          zone_id: string
        }
        Insert: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          date: string
          driver_id?: string | null
          estimated_end_at?: string | null
          estimated_start_at?: string | null
          id?: string
          name: string
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["route_status"]
          total_distance_meters?: number | null
          total_duration_seconds?: number | null
          updated_at?: string
          vehicle_id: string
          version?: number
          zone_id: string
        }
        Update: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          date?: string
          driver_id?: string | null
          estimated_end_at?: string | null
          estimated_start_at?: string | null
          id?: string
          name?: string
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["route_status"]
          total_distance_meters?: number | null
          total_duration_seconds?: number | null
          updated_at?: string
          vehicle_id?: string
          version?: number
          zone_id?: string
        }
        Relationships: []
      }
      stops: {
        Row: {
          actual_arrival_at: string | null
          actual_departure_at: string | null
          created_at: string
          id: string
          load: number[]
          notes: string | null
          planned_arrival_at: string | null
          planned_departure_at: string | null
          route_id: string
          sequence: number
          status: Database["public"]["Enums"]["stop_status"]
          store_id: string
        }
        Insert: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          created_at?: string
          id?: string
          load?: number[]
          notes?: string | null
          planned_arrival_at?: string | null
          planned_departure_at?: string | null
          route_id: string
          sequence: number
          status?: Database["public"]["Enums"]["stop_status"]
          store_id: string
        }
        Update: {
          actual_arrival_at?: string | null
          actual_departure_at?: string | null
          created_at?: string
          id?: string
          load?: number[]
          notes?: string | null
          planned_arrival_at?: string | null
          planned_departure_at?: string | null
          route_id?: string
          sequence?: number
          status?: Database["public"]["Enums"]["stop_status"]
          store_id?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          address: string
          code: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          demand: number[]
          id: string
          is_active: boolean
          lat: number
          lng: number
          name: string
          receiving_window_end: string | null
          receiving_window_start: string | null
          service_time_seconds: number
          zone_id: string
        }
        Insert: {
          address: string
          code: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          demand?: number[]
          id?: string
          is_active?: boolean
          lat: number
          lng: number
          name: string
          receiving_window_end?: string | null
          receiving_window_start?: string | null
          service_time_seconds?: number
          zone_id: string
        }
        Update: {
          address?: string
          code?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          demand?: number[]
          id?: string
          is_active?: boolean
          lat?: number
          lng?: number
          name?: string
          receiving_window_end?: string | null
          receiving_window_start?: string | null
          service_time_seconds?: number
          zone_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          must_reset_password: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          must_reset_password?: boolean
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          must_reset_password?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          alias: string | null
          capacity: number[]
          created_at: string
          depot_id: string | null
          depot_lat: number | null
          depot_lng: number | null
          id: string
          is_active: boolean
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          zone_id: string
        }
        Insert: {
          alias?: string | null
          capacity?: number[]
          created_at?: string
          depot_id?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          id?: string
          is_active?: boolean
          plate: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          zone_id: string
        }
        Update: {
          alias?: string | null
          capacity?: number[]
          created_at?: string
          depot_id?: string | null
          depot_lat?: number | null
          depot_lng?: number | null
          id?: string
          is_active?: boolean
          plate?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_depot_id_fkey"
            columns: ["depot_id"]
            isOneToOne: false
            referencedRelation: "depots"
            referencedColumns: ["id"]
          },
        ]
      }
      depots: {
        Row: {
          id: string
          zone_id: string
          code: string
          name: string
          address: string
          lat: number
          lng: number
          contact_name: string | null
          contact_phone: string | null
          notes: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          zone_id: string
          code: string
          name: string
          address: string
          lat: number
          lng: number
          contact_name?: string | null
          contact_phone?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          zone_id?: string
          code?: string
          name?: string
          address?: string
          lat?: number
          lng?: number
          contact_name?: string | null
          contact_phone?: string | null
          notes?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "depots_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_active_routes: {
        Row: {
          actual_start_at: string | null
          completed_stops: number | null
          date: string | null
          driver_id: string | null
          id: string | null
          name: string | null
          pending_stops: number | null
          status: Database["public"]["Enums"]["route_status"] | null
          total_stops: number | null
          vehicle_id: string | null
          zone_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_user_zone: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      daily_zone_kpis: {
        Args: { target_date: string }
        Returns: {
          completed_routes: number
          completed_stops: number
          reports_with_incidents: number
          reports_with_merma: number
          total_distance_meters: number
          total_routes: number
          total_stops: number
          zone_code: string
          zone_id: string
        }[]
      }
      is_admin_or_dispatcher: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      message_sender: "driver" | "zone_manager" | "system"
      report_status:
        | "draft"
        | "submitted"
        | "resolved_by_driver"
        | "timed_out"
        | "completed"
        | "archived"
      report_type: "entrega" | "tienda_cerrada" | "bascula"
      resolution_type: "completa" | "parcial" | "sin_entrega" | "timed_out"
      route_status:
        | "DRAFT"
        | "OPTIMIZED"
        | "APPROVED"
        | "PUBLISHED"
        | "IN_PROGRESS"
        | "COMPLETED"
        | "CANCELLED"
      stop_status: "pending" | "arrived" | "completed" | "skipped"
      user_role: "admin" | "dispatcher" | "zone_manager" | "driver"
      vehicle_status: "available" | "in_route" | "maintenance" | "inactive"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
