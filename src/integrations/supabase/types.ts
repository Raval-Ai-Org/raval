export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agent_runs: {
        Row: {
          agent: string;
          content_item_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          output: Json | null;
          prompt: string;
          status: string;
          workspace_id: string;
        };
        Insert: {
          agent: string;
          content_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          output?: Json | null;
          prompt: string;
          status?: string;
          workspace_id: string;
        };
        Update: {
          agent?: string;
          content_item_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          output?: Json | null;
          prompt?: string;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_content_item_id_fkey";
            columns: ["content_item_id"];
            isOneToOne: false;
            referencedRelation: "content_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      approvals: {
        Row: {
          action: string;
          content_item_id: string | null;
          created_at: string;
          decided_at: string | null;
          id: string;
          payload: Json;
          status: string;
          workspace_id: string;
        };
        Insert: {
          action: string;
          content_item_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          payload?: Json;
          status?: string;
          workspace_id: string;
        };
        Update: {
          action?: string;
          content_item_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          id?: string;
          payload?: Json;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_content_item_id_fkey";
            columns: ["content_item_id"];
            isOneToOne: false;
            referencedRelation: "content_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          created_at: string;
          entity: string | null;
          id: string;
          payload: Json;
          user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          entity?: string | null;
          id?: string;
          payload?: Json;
          user_id?: string | null;
          workspace_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity?: string | null;
          id?: string;
          payload?: Json;
          user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          kind: string;
          payload: Json;
          role: string;
          workspace_id: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          payload?: Json;
          role: string;
          workspace_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          payload?: Json;
          role?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      client_events: {
        Row: {
          actor_email: string | null;
          actor_name: string | null;
          body: string | null;
          created_at: string;
          id: string;
          item_id: string | null;
          kind: string;
          marketer_decided_at: string | null;
          marketer_decided_by: string | null;
          marketer_decision: string;
          meta: Json;
          share_id: string;
        };
        Insert: {
          actor_email?: string | null;
          actor_name?: string | null;
          body?: string | null;
          created_at?: string;
          id?: string;
          item_id?: string | null;
          kind: string;
          marketer_decided_at?: string | null;
          marketer_decided_by?: string | null;
          marketer_decision?: string;
          meta?: Json;
          share_id: string;
        };
        Update: {
          actor_email?: string | null;
          actor_name?: string | null;
          body?: string | null;
          created_at?: string;
          id?: string;
          item_id?: string | null;
          kind?: string;
          marketer_decided_at?: string | null;
          marketer_decided_by?: string | null;
          marketer_decision?: string;
          meta?: Json;
          share_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_events_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "client_share_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_events_share_id_fkey";
            columns: ["share_id"];
            isOneToOne: false;
            referencedRelation: "client_shares";
            referencedColumns: ["id"];
          },
        ];
      };
      client_share_items: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          kind: string;
          position: number;
          ref_id: string | null;
          share_id: string;
          snapshot: Json;
          title: string | null;
          visible: boolean;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          kind: string;
          position?: number;
          ref_id?: string | null;
          share_id: string;
          snapshot?: Json;
          title?: string | null;
          visible?: boolean;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          kind?: string;
          position?: number;
          ref_id?: string | null;
          share_id?: string;
          snapshot?: Json;
          title?: string | null;
          visible?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "client_share_items_share_id_fkey";
            columns: ["share_id"];
            isOneToOne: false;
            referencedRelation: "client_shares";
            referencedColumns: ["id"];
          },
        ];
      };
      client_shares: {
        Row: {
          allow_approvals: boolean;
          allow_comments: boolean;
          allow_download: boolean;
          branding: Json;
          client_email: string | null;
          client_name: string | null;
          created_at: string;
          expires_at: string | null;
          id: string;
          last_viewed_at: string | null;
          owner_id: string;
          password_hash: string | null;
          slug: string;
          status: string;
          title: string;
          token_hash: string;
          updated_at: string;
          view_count: number;
          workspace_id: string;
        };
        Insert: {
          allow_approvals?: boolean;
          allow_comments?: boolean;
          allow_download?: boolean;
          branding?: Json;
          client_email?: string | null;
          client_name?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_viewed_at?: string | null;
          owner_id: string;
          password_hash?: string | null;
          slug: string;
          status?: string;
          title?: string;
          token_hash: string;
          updated_at?: string;
          view_count?: number;
          workspace_id: string;
        };
        Update: {
          allow_approvals?: boolean;
          allow_comments?: boolean;
          allow_download?: boolean;
          branding?: Json;
          client_email?: string | null;
          client_name?: string | null;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          last_viewed_at?: string | null;
          owner_id?: string;
          password_hash?: string | null;
          slug?: string;
          status?: string;
          title?: string;
          token_hash?: string;
          updated_at?: string;
          view_count?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_shares_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      competitor_alerts: {
        Row: {
          after_value: string | null;
          before_value: string | null;
          detail: string | null;
          detected_at: string;
          id: string;
          kind: string;
          read_at: string | null;
          severity: string;
          source_url: string | null;
          title: string;
          watch_id: string;
          workspace_id: string;
        };
        Insert: {
          after_value?: string | null;
          before_value?: string | null;
          detail?: string | null;
          detected_at?: string;
          id?: string;
          kind: string;
          read_at?: string | null;
          severity?: string;
          source_url?: string | null;
          title: string;
          watch_id: string;
          workspace_id: string;
        };
        Update: {
          after_value?: string | null;
          before_value?: string | null;
          detail?: string | null;
          detected_at?: string;
          id?: string;
          kind?: string;
          read_at?: string | null;
          severity?: string;
          source_url?: string | null;
          title?: string;
          watch_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "competitor_alerts_watch_id_fkey";
            columns: ["watch_id"];
            isOneToOne: false;
            referencedRelation: "competitor_watches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "competitor_alerts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      competitor_watches: {
        Row: {
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          id: string;
          last_checked_at: string | null;
          last_error: string | null;
          last_snapshot: Json | null;
          name: string | null;
          updated_at: string;
          url: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          last_checked_at?: string | null;
          last_error?: string | null;
          last_snapshot?: Json | null;
          name?: string | null;
          updated_at?: string;
          url: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          id?: string;
          last_checked_at?: string | null;
          last_error?: string | null;
          last_snapshot?: Json | null;
          name?: string | null;
          updated_at?: string;
          url?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "competitor_watches_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      content_items: {
        Row: {
          agent: string;
          body: string | null;
          channel: string | null;
          created_at: string;
          created_by: string | null;
          hashtags: string[] | null;
          id: string;
          kind: string;
          media_url: string | null;
          meta: Json | null;
          metrics: Json | null;
          scheduled_at: string | null;
          status: string;
          title: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          agent?: string;
          body?: string | null;
          channel?: string | null;
          created_at?: string;
          created_by?: string | null;
          hashtags?: string[] | null;
          id?: string;
          kind?: string;
          media_url?: string | null;
          meta?: Json | null;
          metrics?: Json | null;
          scheduled_at?: string | null;
          status?: string;
          title?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          agent?: string;
          body?: string | null;
          channel?: string | null;
          created_at?: string;
          created_by?: string | null;
          hashtags?: string[] | null;
          id?: string;
          kind?: string;
          media_url?: string | null;
          meta?: Json | null;
          metrics?: Json | null;
          scheduled_at?: string | null;
          status?: string;
          title?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_items_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      geo_audit_runs: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          meta: Json;
          score: number;
          subscores: Json;
          url: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          meta?: Json;
          score: number;
          subscores?: Json;
          url?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          meta?: Json;
          score?: number;
          subscores?: Json;
          url?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "geo_audit_runs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      memory_insights: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
          meta: Json;
          source_label: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          meta?: Json;
          source_label?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
          meta?: Json;
          source_label?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memory_insights_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          id: string;
          name: string | null;
          persona: string | null;
          persona_set_at: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          id: string;
          name?: string | null;
          persona?: string | null;
          persona_set_at?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          id?: string;
          name?: string | null;
          persona?: string | null;
          persona_set_at?: string | null;
        };
        Relationships: [];
      };
      scheduled_jobs: {
        Row: {
          active: boolean;
          agent: string;
          cadence: string;
          channel: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          last_content_item_id: string | null;
          last_run_at: string | null;
          last_run_error: string | null;
          last_run_status: string | null;
          meta: Json;
          next_run_at: string;
          prompt: string | null;
          run_count: number;
          task_type: string;
          timezone: string;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          active?: boolean;
          agent?: string;
          cadence?: string;
          channel?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          last_content_item_id?: string | null;
          last_run_at?: string | null;
          last_run_error?: string | null;
          last_run_status?: string | null;
          meta?: Json;
          next_run_at: string;
          prompt?: string | null;
          run_count?: number;
          task_type?: string;
          timezone?: string;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          active?: boolean;
          agent?: string;
          cadence?: string;
          channel?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          last_content_item_id?: string | null;
          last_run_at?: string | null;
          last_run_error?: string | null;
          last_run_status?: string | null;
          meta?: Json;
          next_run_at?: string;
          prompt?: string | null;
          run_count?: number;
          task_type?: string;
          timezone?: string;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          role: string;
          token: string;
          workspace_id: string;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          role?: string;
          token?: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          role?: string;
          token?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          audience: string | null;
          brand_voice: Json;
          client_status: Database["public"]["Enums"]["client_status"];
          connected_provider: string | null;
          created_at: string;
          first_prompt: string | null;
          goals: string | null;
          id: string;
          industry: string | null;
          name: string;
          onboarded_at: string | null;
          owner_id: string;
          plan: string;
          website_url: string | null;
        };
        Insert: {
          audience?: string | null;
          brand_voice?: Json;
          client_status?: Database["public"]["Enums"]["client_status"];
          connected_provider?: string | null;
          created_at?: string;
          first_prompt?: string | null;
          goals?: string | null;
          id?: string;
          industry?: string | null;
          name?: string;
          onboarded_at?: string | null;
          owner_id: string;
          plan?: string;
          website_url?: string | null;
        };
        Update: {
          audience?: string | null;
          brand_voice?: Json;
          client_status?: Database["public"]["Enums"]["client_status"];
          connected_provider?: string | null;
          created_at?: string;
          first_prompt?: string | null;
          goals?: string | null;
          id?: string;
          industry?: string | null;
          name?: string;
          onboarded_at?: string | null;
          owner_id?: string;
          plan?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      workspace_sdr: {
        Row: {
          created_at: string;
          encrypted_api_key: string;
          id: string;
          last_provisioned_at: string | null;
          sdr_base_url: string;
          sdr_workspace_id: string;
          status: string;
          updated_at: string;
          webhook_secret: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_api_key: string;
          id?: string;
          last_provisioned_at?: string | null;
          sdr_base_url: string;
          sdr_workspace_id: string;
          status?: string;
          updated_at?: string;
          webhook_secret?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_api_key?: string;
          id?: string;
          last_provisioned_at?: string | null;
          sdr_base_url?: string;
          sdr_workspace_id?: string;
          status?: string;
          updated_at?: string;
          webhook_secret?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_sdr_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      content_publications: {
        Row: {
          account_id: string;
          attempt: number;
          content_item_id: string;
          created_at: string;
          delivered_at: string | null;
          error_category: string | null;
          id: string;
          last_error: string | null;
          platform: string;
          platform_post_id: string | null;
          platform_post_url: string | null;
          sdr_post_id: string;
          sdr_target_id: string;
          status: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          account_id: string;
          attempt?: number;
          content_item_id: string;
          created_at?: string;
          delivered_at?: string | null;
          error_category?: string | null;
          id?: string;
          last_error?: string | null;
          platform: string;
          platform_post_id?: string | null;
          platform_post_url?: string | null;
          sdr_post_id: string;
          sdr_target_id: string;
          status?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          account_id?: string;
          attempt?: number;
          content_item_id?: string;
          created_at?: string;
          delivered_at?: string | null;
          error_category?: string | null;
          id?: string;
          last_error?: string | null;
          platform?: string;
          platform_post_id?: string | null;
          platform_post_url?: string | null;
          sdr_post_id?: string;
          sdr_target_id?: string;
          status?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_publications_content_item_id_fkey";
            columns: ["content_item_id"];
            isOneToOne: false;
            referencedRelation: "content_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_publications_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_workspace_invite: { Args: { _token: string }; Returns: string };
      create_workspace: {
        Args: { p_name: string; p_website_url?: string };
        Returns: string;
      };
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string };
        Returns: boolean;
      };
      log_audit: {
        Args: {
          _action: string;
          _entity?: string;
          _payload?: Json;
          _workspace_id: string;
        };
        Returns: string;
      };
      my_workspace_role: { Args: { _workspace_id: string }; Returns: string };
      set_persona_once: {
        Args: { _persona: string };
        Returns: {
          persona: string;
          persona_set_at: string;
        }[];
      };
      workspace_member_profiles: {
        Args: { _workspace_id: string };
        Returns: {
          avatar_url: string;
          joined_at: string;
          name: string;
          role: string;
          user_id: string;
        }[];
      };
    };
    Enums: {
      app_role: "owner" | "admin" | "editor" | "viewer";
      client_status: "active" | "onboarding" | "paused";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "editor", "viewer"],
      client_status: ["active", "onboarding", "paused"],
    },
  },
} as const;
