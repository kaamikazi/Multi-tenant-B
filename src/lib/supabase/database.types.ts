export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          cancel_token: string
          created_at: string
          created_by: string | null
          email: string
          ends_at: string
          id: string
          lead_id: string | null
          name: string
          notes: string | null
          source: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancel_token?: string
          created_at?: string
          created_by?: string | null
          email: string
          ends_at: string
          id?: string
          lead_id?: string | null
          name: string
          notes?: string | null
          source?: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          cancel_token?: string
          created_at?: string
          created_by?: string | null
          email?: string
          ends_at?: string
          id?: string
          lead_id?: string | null
          name?: string
          notes?: string | null
          source?: Database["public"]["Enums"]["appointment_source"]
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_lead_id_tenant_id_fkey"
            columns: ["lead_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "appointments_lead_id_tenant_id_fkey"
            columns: ["lead_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "leads_scored"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing: {
        Row: {
          cancel_at_period_end: boolean
          current_period_end: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_settings: {
        Row: {
          days: number[]
          enabled: boolean
          end_time: string
          headline: string
          horizon_days: number
          min_notice_hours: number
          slot_minutes: number
          start_time: string
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          days?: number[]
          enabled?: boolean
          end_time?: string
          headline?: string
          horizon_days?: number
          min_notice_hours?: number
          slot_minutes?: number
          start_time?: string
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          days?: number[]
          enabled?: boolean
          end_time?: string
          headline?: string
          horizon_days?: number
          min_notice_hours?: number
          slot_minutes?: number
          start_time?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          tenant_id: string
          thread_id: string
          tokens_used: number | null
          tools_used: string[]
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          thread_id: string
          tokens_used?: number | null
          tools_used?: string[]
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          thread_id?: string
          tokens_used?: number | null
          tools_used?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_tenant_id_fkey"
            columns: ["thread_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          generating_until: string | null
          id: string
          tenant_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          generating_until?: string | null
          id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          generating_until?: string | null
          id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          budget_usd: number | null
          company: string | null
          company_size: number | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          last_engaged_at: string | null
          name: string
          notes: string | null
          owner_id: string | null
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          budget_usd?: number | null
          company?: string | null
          company_size?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          last_engaged_at?: string | null
          name: string
          notes?: string | null
          owner_id?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          budget_usd?: number | null
          company?: string | null
          company_size?: number | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          last_engaged_at?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          status?: Database["public"]["Enums"]["lead_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_id_tenant_id_fkey"
            columns: ["owner_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_enabled: boolean
          created_at: string
          id: string
          name: string
          plan: Database["public"]["Enums"]["plan"]
          slug: string
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          created_at?: string
          id?: string
          name: string
          plan?: Database["public"]["Enums"]["plan"]
          slug: string
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          created_at?: string
          id?: string
          name?: string
          plan?: Database["public"]["Enums"]["plan"]
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      leads_scored: {
        Row: {
          breakdown: Json | null
          budget_usd: number | null
          company: string | null
          company_size: number | null
          created_at: string | null
          created_by: string | null
          email: string | null
          id: string | null
          last_engaged_at: string | null
          name: string | null
          notes: string | null
          owner_id: string | null
          score: number | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["lead_status"] | null
          tenant_id: string | null
          tier: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_id_tenant_id_fkey"
            columns: ["owner_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      ai_list_appointments: {
        Args: {
          p_from: string
          p_include_cancelled?: boolean
          p_limit?: number
          p_mine?: boolean
          p_to: string
        }
        Returns: {
          ends_at: string
          lead_name: string
          name: string
          source: Database["public"]["Enums"]["appointment_source"]
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
        }[]
      }
      ai_list_leads: {
        Args: {
          p_limit?: number
          p_mine?: boolean
          p_status?: string
          p_tier?: string
        }
        Returns: {
          breakdown: Json
          company: string
          last_engaged_at: string
          name: string
          owner_is_me: boolean
          owner_name: string
          score: number
          source: Database["public"]["Enums"]["lead_source"]
          status: Database["public"]["Enums"]["lead_status"]
          tier: string
        }[]
      }
      ai_pipeline_summary: {
        Args: never
        Returns: {
          average_open_score: number
          lost: number
          open_cold: number
          open_hot: number
          open_leads: number
          open_warm: number
          total_leads: number
          unassigned_open: number
          won: number
        }[]
      }
      ai_team_overview: {
        Args: never
        Returns: {
          admins: number
          members: number
          owners: number
          team_size: number
        }[]
      }
      book_appointment: {
        Args: {
          p_email: string
          p_name: string
          p_notes?: string
          p_slug: string
          p_starts_at: string
        }
        Returns: {
          appointment_id: string
          cancel_token: string
          ends_at: string
          starts_at: string
        }[]
      }
      cancel_booking: { Args: { p_token: string }; Returns: undefined }
      get_ai_usage: {
        Args: never
        Returns: {
          ai_enabled: boolean
          message_limit: number
          used: number
        }[]
      }
      get_booking: {
        Args: { p_token: string }
        Returns: {
          ends_at: string
          name: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_name: string
          tenant_slug: string
          timezone: string
        }[]
      }
      get_booking_page: {
        Args: { p_slug: string }
        Returns: {
          enabled: boolean
          headline: string
          slot_minutes: number
          tenant_name: string
          timezone: string
        }[]
      }
      get_invitation: {
        Args: { p_token: string }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["tenant_role"]
          status: string
          tenant_name: string
        }[]
      }
      get_open_slots: {
        Args: { p_days?: number; p_slug: string }
        Returns: {
          ends_at: string
          starts_at: string
        }[]
      }
      get_seat_usage: {
        Args: never
        Returns: {
          members: number
          over_limit: boolean
          seat_limit: number
          used: number
        }[]
      }
      record_assistant_message: {
        Args: {
          p_content: string
          p_thread: string
          p_tokens?: number
          p_tools?: string[]
          p_user: string
        }
        Returns: string
      }
      set_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["tenant_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      transfer_ownership: { Args: { p_new_owner: string }; Returns: undefined }
    }
    Enums: {
      appointment_source: "booking_page" | "team"
      appointment_status: "booked" | "cancelled" | "completed"
      lead_source:
        | "referral"
        | "demo_request"
        | "webinar"
        | "organic_search"
        | "paid_ads"
        | "social"
        | "cold_outreach"
        | "other"
      lead_status: "new" | "contacted" | "qualified" | "won" | "lost"
      plan: "free" | "pro"
      tenant_role: "owner" | "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_source: ["booking_page", "team"],
      appointment_status: ["booked", "cancelled", "completed"],
      lead_source: [
        "referral",
        "demo_request",
        "webinar",
        "organic_search",
        "paid_ads",
        "social",
        "cold_outreach",
        "other",
      ],
      lead_status: ["new", "contacted", "qualified", "won", "lost"],
      plan: ["free", "pro"],
      tenant_role: ["owner", "admin", "member"],
    },
  },
} as const
