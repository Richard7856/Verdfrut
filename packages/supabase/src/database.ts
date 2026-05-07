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
          chat_opened_at: string | null
          chat_status: string | null
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
          chat_opened_at?: string | null
          chat_status?: string | null
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
          chat_opened_at?: string | null
          chat_status?: string | null
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
      depots: {
        Row: {
          address: string
          code: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          lat: number
          lng: number
          name: string
          notes: string | null
          zone_id: string
        }
        Insert: {
          address: string
          code: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lat: number
          lng: number
          name: string
          notes?: string | null
          zone_id: string
        }
        Update: {
          address?: string
          code?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          lat?: number
          lng?: number
          name?: string
          notes?: string | null
          zone_id?: string
        }
        Relationships: []
      }
      dispatches: {
        Row: {
          id: string
          name: string
          date: string
          zone_id: string
          status: string
          notes: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          date: string
          zone_id: string
          status?: string
          notes?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          date?: string
          zone_id?: string
          status?: string
          notes?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
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
      route_transfers: {
        Row: {
          id: string
          source_route_id: string
          target_route_id: string
          reason: string
          transferred_stop_count: number
          performed_by: string | null
          performed_at: string
        }
        Insert: {
          id?: string
          source_route_id: string
          target_route_id: string
          reason: string
          transferred_stop_count: number
          performed_by?: string | null
          performed_at?: string
        }
        Update: {
          id?: string
          source_route_id?: string
          target_route_id?: string
          reason?: string
          transferred_stop_count?: number
          performed_by?: string | null
          performed_at?: string
        }
        Relationships: []
      }
      route_gap_events: {
        Row: {
          id: string
          route_id: string
          driver_id: string | null
          started_at: string
          ended_at: string | null
          duration_seconds: number | null
          last_known_lat: number | null
          last_known_lng: number | null
          end_reason: 'back_to_app' | 'timeout' | 'closed' | 'route_completed' | null
          created_at: string
        }
        Insert: {
          id?: string
          route_id: string
          driver_id?: string | null
          started_at: string
          ended_at?: string | null
          duration_seconds?: number | null
          last_known_lat?: number | null
          last_known_lng?: number | null
          end_reason?: 'back_to_app' | 'timeout' | 'closed' | 'route_completed' | null
          created_at?: string
        }
        Update: {
          id?: string
          route_id?: string
          driver_id?: string | null
          started_at?: string
          ended_at?: string | null
          duration_seconds?: number | null
          last_known_lat?: number | null
          last_known_lng?: number | null
          end_reason?: 'back_to_app' | 'timeout' | 'closed' | 'route_completed' | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'route_gap_events_route_id_fkey'
            columns: ['route_id']
            isOneToOne: false
            referencedRelation: 'routes'
            referencedColumns: ['id']
          },
        ]
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
          actual_distance_meters: number | null
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
          dispatch_id: string | null
        }
        Insert: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          actual_distance_meters?: number | null
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
          dispatch_id?: string | null
        }
        Update: {
          actual_end_at?: string | null
          actual_start_at?: string | null
          actual_distance_meters?: number | null
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
          dispatch_id?: string | null
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
        Relationships: []
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
        Relationships: []
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
      current_user_role: { Args: never; Returns: Database["public"]["Enums"]["user_role"] }
      current_user_zone: { Args: never; Returns: string }
      get_active_anomalies: {
        Args: { zone_id_filter?: string | null }
        Returns: {
          kind: 'silent_driver' | 'route_delayed' | 'chat_open_long'
          severity: 'high' | 'medium'
          route_id: string
          driver_id: string | null
          driver_name: string | null
          store_name: string | null
          zone_id: string
          detected_at: string
          details: Record<string, unknown>
        }[]
      }
      get_dashboard_daily_series: {
        Args: { from_date: string; to_date: string; zone_id_filter?: string | null }
        Returns: { day: string; deliveries: number; billed: number }[]
      }
      get_dashboard_overview: {
        Args: { from_date: string; to_date: string; zone_id_filter?: string | null }
        Returns: {
          routes_completed: number
          stores_visited: number
          stops_total: number
          stops_completed: number
          total_distance_meters: number
          num_tickets: number
          total_billed: number
          total_returned: number
          total_incidents: number
          num_closed_stores: number
          num_scale_issues: number
          num_escalations: number
        }[]
      }
      get_dashboard_top_drivers: {
        Args: {
          from_date: string
          to_date: string
          zone_id_filter?: string | null
          row_limit?: number
        }
        Returns: {
          driver_id: string
          driver_name: string
          routes_count: number
          stops_completed: number
          total_distance_meters: number
          total_billed: number
        }[]
      }
      get_dashboard_top_stores: {
        Args: {
          from_date: string
          to_date: string
          zone_id_filter?: string | null
          row_limit?: number
        }
        Returns: {
          store_id: string
          store_code: string
          store_name: string
          visits: number
          total_billed: number
          incidents: number
        }[]
      }
      get_orphan_auth_users: {
        Args: never
        Returns: { user_id: string; email: string | null; created_at: string }[]
      }
      is_admin_or_dispatcher: { Args: never; Returns: boolean }
      mark_timed_out_chats: { Args: never; Returns: number }
      archive_old_breadcrumbs: {
        Args: { retention_days?: number }
        Returns: number
      }
      calc_route_actual_distance: {
        Args: { target_route_id: string }
        Returns: number
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
        | "INTERRUPTED"
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
  control_plane: {
    Tables: {
      tenants: {
        Row: {
          id: string
          slug: string
          name: string
          status: 'provisioning' | 'active' | 'suspended' | 'archived'
          plan: 'starter' | 'pro' | 'enterprise'
          supabase_project_ref: string | null
          supabase_url: string | null
          timezone: string
          contact_email: string | null
          contact_phone: string | null
          contracted_at: string | null
          monthly_fee: number | null
          last_sync_at: string | null
          last_sync_error: string | null
          cached_zone_count: number
          cached_driver_count: number
          cached_active_route_count: number
          notes: string | null
          metadata: Record<string, unknown>
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          status?: 'provisioning' | 'active' | 'suspended' | 'archived'
          plan?: 'starter' | 'pro' | 'enterprise'
          supabase_project_ref?: string | null
          supabase_url?: string | null
          timezone?: string
          contact_email?: string | null
          contact_phone?: string | null
          contracted_at?: string | null
          monthly_fee?: number | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          cached_zone_count?: number
          cached_driver_count?: number
          cached_active_route_count?: number
          notes?: string | null
          metadata?: Record<string, unknown>
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          status?: 'provisioning' | 'active' | 'suspended' | 'archived'
          plan?: 'starter' | 'pro' | 'enterprise'
          supabase_project_ref?: string | null
          supabase_url?: string | null
          timezone?: string
          contact_email?: string | null
          contact_phone?: string | null
          contracted_at?: string | null
          monthly_fee?: number | null
          last_sync_at?: string | null
          last_sync_error?: string | null
          cached_zone_count?: number
          cached_driver_count?: number
          cached_active_route_count?: number
          notes?: string | null
          metadata?: Record<string, unknown>
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenant_kpi_snapshots: {
        Row: {
          id: string
          tenant_id: string
          snapshot_date: string
          routes_completed: number
          stores_visited: number
          stops_total: number
          stops_completed: number
          total_distance_meters: number
          num_tickets: number
          total_billed: number
          total_returned: number
          total_incidents: number
          num_closed_stores: number
          num_scale_issues: number
          num_escalations: number
          raw_payload: Record<string, unknown> | null
          synced_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          snapshot_date: string
          routes_completed?: number
          stores_visited?: number
          stops_total?: number
          stops_completed?: number
          total_distance_meters?: number
          num_tickets?: number
          total_billed?: number
          total_returned?: number
          total_incidents?: number
          num_closed_stores?: number
          num_scale_issues?: number
          num_escalations?: number
          raw_payload?: Record<string, unknown> | null
          synced_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          snapshot_date?: string
          routes_completed?: number
          stores_visited?: number
          stops_total?: number
          stops_completed?: number
          total_distance_meters?: number
          num_tickets?: number
          total_billed?: number
          total_returned?: number
          total_incidents?: number
          num_closed_stores?: number
          num_scale_issues?: number
          num_escalations?: number
          raw_payload?: Record<string, unknown> | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_kpi_snapshots_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      admin_users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'admin' | 'support'
          is_active: boolean
          last_login_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          full_name: string
          role?: 'admin' | 'support'
          is_active?: boolean
          last_login_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'admin' | 'support'
          is_active?: boolean
          last_login_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: string
          actor_email: string | null
          action: string
          target_type: string | null
          target_id: string | null
          details: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          actor_email?: string | null
          action: string
          target_type?: string | null
          target_id?: string | null
          details?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          id?: string
          actor_email?: string | null
          action?: string
          target_type?: string | null
          target_id?: string | null
          details?: Record<string, unknown>
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
