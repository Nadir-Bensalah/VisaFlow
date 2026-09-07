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
      activity_events: {
        Row: {
          actor_id: string | null
          actor_token: string | null
          agency_id: string
          at: string
          automated: boolean
          case_id: string | null
          client_id: string | null
          detail: Json
          id: string
          ip: unknown
          shipment_id: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          actor_token?: string | null
          agency_id: string
          at?: string
          automated?: boolean
          case_id?: string | null
          client_id?: string | null
          detail: Json
          id?: string
          ip?: unknown
          shipment_id?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          actor_token?: string | null
          agency_id?: string
          at?: string
          automated?: boolean
          case_id?: string | null
          client_id?: string | null
          detail?: Json
          id?: string
          ip?: unknown
          shipment_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "activity_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      agencies: {
        Row: {
          accent: string
          country: string
          created_at: string
          currency: string
          default_locale: string
          deleted_at: string | null
          email: string | null
          id: string
          inpdp_ref: string | null
          legal_name: string | null
          locales: string[]
          mark: string
          name: string
          phone: string | null
          plan: string
          services: string[]
          setup_done: string[]
          setup_hidden: boolean
          slug: string
          suspended_at: string | null
          tax_id: string | null
          trial_ends_at: string | null
          verified_at: string | null
          website: string | null
        }
        Insert: {
          accent?: string
          country?: string
          created_at?: string
          currency?: string
          default_locale?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          inpdp_ref?: string | null
          legal_name?: string | null
          locales?: string[]
          mark?: string
          name: string
          phone?: string | null
          plan?: string
          services?: string[]
          setup_done?: string[]
          setup_hidden?: boolean
          slug: string
          suspended_at?: string | null
          tax_id?: string | null
          trial_ends_at?: string | null
          verified_at?: string | null
          website?: string | null
        }
        Update: {
          accent?: string
          country?: string
          created_at?: string
          currency?: string
          default_locale?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          inpdp_ref?: string | null
          legal_name?: string | null
          locales?: string[]
          mark?: string
          name?: string
          phone?: string | null
          plan?: string
          services?: string[]
          setup_done?: string[]
          setup_hidden?: boolean
          slug?: string
          suspended_at?: string | null
          tax_id?: string | null
          trial_ends_at?: string | null
          verified_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      appointment_queue: {
        Row: {
          agency_id: string
          appointment_id: string | null
          case_id: string
          consulate_id: string
          id: string
          joined_at: string
          left_at: string | null
          note: string | null
          priority: string
          served_at: string | null
          served_by: string | null
          status: string
        }
        Insert: {
          agency_id: string
          appointment_id?: string | null
          case_id: string
          consulate_id: string
          id?: string
          joined_at?: string
          left_at?: string | null
          note?: string | null
          priority?: string
          served_at?: string | null
          served_by?: string | null
          status?: string
        }
        Update: {
          agency_id?: string
          appointment_id?: string | null
          case_id?: string
          consulate_id?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          note?: string | null
          priority?: string
          served_at?: string | null
          served_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_queue_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_queue_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_queue_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_queue_consulate_id_fkey"
            columns: ["consulate_id"]
            isOneToOne: false
            referencedRelation: "consulates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_queue_served_by_fkey"
            columns: ["served_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          agency_id: string
          at: string
          case_id: string | null
          created_at: string
          created_by: string | null
          duration_min: number
          id: string
          kind: string
          location: string | null
          notes: string | null
          office_id: string | null
          shipment_id: string | null
          status: string
        }
        Insert: {
          agency_id: string
          at: string
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_min?: number
          id?: string
          kind: string
          location?: string | null
          notes?: string | null
          office_id?: string | null
          shipment_id?: string | null
          status?: string
        }
        Update: {
          agency_id?: string
          at?: string
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          duration_min?: number
          id?: string
          kind?: string
          location?: string | null
          notes?: string | null
          office_id?: string | null
          shipment_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "appointments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_firings: {
        Row: {
          agency_id: string
          fired_at: string
          id: string
          rule_id: string
          subject: string
        }
        Insert: {
          agency_id: string
          fired_at?: string
          id?: string
          rule_id: string
          subject: string
        }
        Update: {
          agency_id?: string
          fired_at?: string
          id?: string
          rule_id?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_firings_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_firings_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action: Json
          active: boolean
          agency_id: string
          cooldown_hours: number
          created_at: string
          id: string
          last_run_at: string | null
          name: Json
          runs: number
          trigger: Json
        }
        Insert: {
          action: Json
          active?: boolean
          agency_id: string
          cooldown_hours?: number
          created_at?: string
          id?: string
          last_run_at?: string | null
          name: Json
          runs?: number
          trigger: Json
        }
        Update: {
          action?: Json
          active?: boolean
          agency_id?: string
          cooldown_hours?: number
          created_at?: string
          id?: string
          last_run_at?: string | null
          name?: Json
          runs?: number
          trigger?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      case_documents: {
        Row: {
          agency_id: string
          case_id: string
          expires_at: string | null
          file_name: string | null
          file_size: number | null
          help: Json | null
          id: string
          key: string
          label: Json
          last_reminder_at: string | null
          received_at: string | null
          received_channel: string | null
          rejection_reason: string | null
          reminders: number
          requested_at: string | null
          required: boolean
          state: string
          storage_path: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          agency_id: string
          case_id: string
          expires_at?: string | null
          file_name?: string | null
          file_size?: number | null
          help?: Json | null
          id?: string
          key: string
          label: Json
          last_reminder_at?: string | null
          received_at?: string | null
          received_channel?: string | null
          rejection_reason?: string | null
          reminders?: number
          requested_at?: string | null
          required?: boolean
          state?: string
          storage_path?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          agency_id?: string
          case_id?: string
          expires_at?: string | null
          file_name?: string | null
          file_size?: number | null
          help?: Json | null
          id?: string
          key?: string
          label?: Json
          last_reminder_at?: string | null
          received_at?: string | null
          received_channel?: string | null
          rejection_reason?: string | null
          reminders?: number
          requested_at?: string | null
          required?: boolean
          state?: string
          storage_path?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_documents_validated_by_fkey"
            columns: ["validated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_groups: {
        Row: {
          agency_id: string
          created_at: string
          id: string
          label: string
        }
        Insert: {
          agency_id: string
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          agency_id?: string
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_groups_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      case_notes: {
        Row: {
          agency_id: string
          at: string
          author_id: string | null
          case_id: string | null
          id: string
          kind: string
          shipment_id: string | null
          text: string
        }
        Insert: {
          agency_id: string
          at?: string
          author_id?: string | null
          case_id?: string | null
          id?: string
          kind?: string
          shipment_id?: string | null
          text: string
        }
        Update: {
          agency_id?: string
          at?: string
          author_id?: string | null
          case_id?: string | null
          id?: string
          kind?: string
          shipment_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_notes_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          agency_id: string
          amount_paid: number
          amount_total: number
          appeal_due_at: string | null
          appeal_filed_at: string | null
          assignee_id: string | null
          checklist_version_id: string | null
          client_id: string
          closed_at: string | null
          consulate_id: string | null
          consulate_ref: string | null
          currency: string
          decision_at: string | null
          due_at: string | null
          group_id: string | null
          id: string
          office_id: string | null
          opened_at: string
          partner_id: string | null
          portal_expires_at: string | null
          portal_token: string
          priority: string
          purge_after: string | null
          reference: string
          refusal_code: string | null
          refusal_reason: string | null
          retry_of: string | null
          source: string
          stage: string
          status: string
          track: string | null
          travel_date: string | null
          updated_at: string
          visa_type_id: string
        }
        Insert: {
          agency_id: string
          amount_paid?: number
          amount_total?: number
          appeal_due_at?: string | null
          appeal_filed_at?: string | null
          assignee_id?: string | null
          checklist_version_id?: string | null
          client_id: string
          closed_at?: string | null
          consulate_id?: string | null
          consulate_ref?: string | null
          currency?: string
          decision_at?: string | null
          due_at?: string | null
          group_id?: string | null
          id?: string
          office_id?: string | null
          opened_at?: string
          partner_id?: string | null
          portal_expires_at?: string | null
          portal_token?: string
          priority?: string
          purge_after?: string | null
          reference: string
          refusal_code?: string | null
          refusal_reason?: string | null
          retry_of?: string | null
          source?: string
          stage?: string
          status?: string
          track?: string | null
          travel_date?: string | null
          updated_at?: string
          visa_type_id: string
        }
        Update: {
          agency_id?: string
          amount_paid?: number
          amount_total?: number
          appeal_due_at?: string | null
          appeal_filed_at?: string | null
          assignee_id?: string | null
          checklist_version_id?: string | null
          client_id?: string
          closed_at?: string | null
          consulate_id?: string | null
          consulate_ref?: string | null
          currency?: string
          decision_at?: string | null
          due_at?: string | null
          group_id?: string | null
          id?: string
          office_id?: string | null
          opened_at?: string
          partner_id?: string | null
          portal_expires_at?: string | null
          portal_token?: string
          priority?: string
          purge_after?: string | null
          reference?: string
          refusal_code?: string | null
          refusal_reason?: string | null
          retry_of?: string | null
          source?: string
          stage?: string
          status?: string
          track?: string | null
          travel_date?: string | null
          updated_at?: string
          visa_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_checklist_version_id_fkey"
            columns: ["checklist_version_id"]
            isOneToOne: false
            referencedRelation: "checklist_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_consulate_id_fkey"
            columns: ["consulate_id"]
            isOneToOne: false
            referencedRelation: "consulates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "case_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_retry_of_fkey"
            columns: ["retry_of"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_types"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          agency_id: string
          amount: number
          at: string
          author_id: string | null
          currency: string
          direction: string
          id: string
          payment_id: string | null
          reason: string | null
          session_id: string
        }
        Insert: {
          agency_id: string
          amount: number
          at?: string
          author_id?: string | null
          currency?: string
          direction: string
          id?: string
          payment_id?: string | null
          reason?: string | null
          session_id: string
        }
        Update: {
          agency_id?: string
          amount?: number
          at?: string
          author_id?: string | null
          currency?: string
          direction?: string
          id?: string
          payment_id?: string | null
          reason?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "revenue_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          agency_id: string
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          currency: string
          expected_cash: number | null
          id: string
          note: string | null
          office_id: string
          opened_at: string
          opened_by: string | null
          opening_float: number
        }
        Insert: {
          agency_id: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          currency?: string
          expected_cash?: number | null
          id?: string
          note?: string | null
          office_id: string
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
        }
        Update: {
          agency_id?: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          currency?: string
          expected_cash?: number | null
          id?: string
          note?: string | null
          office_id?: string
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_versions: {
        Row: {
          agency_id: string
          checklist_id: string
          created_at: string
          created_by: string | null
          id: string
          items: Json
          note: string | null
          version: number
        }
        Insert: {
          agency_id: string
          checklist_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          note?: string | null
          version: number
        }
        Update: {
          agency_id?: string
          checklist_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          items?: Json
          note?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "checklist_versions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_versions_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          agency_id: string
          archived: boolean
          created_at: string
          id: string
          name: Json
        }
        Insert: {
          agency_id: string
          archived?: boolean
          created_at?: string
          id?: string
          name: Json
        }
        Update: {
          agency_id?: string
          archived?: boolean
          created_at?: string
          id?: string
          name?: Json
        }
        Relationships: [
          {
            foreignKeyName: "checklists_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      client_devices: {
        Row: {
          agency_id: string
          client_id: string | null
          created_at: string
          expires_at: string
          id: string
          label: string | null
          last_seen_at: string | null
          phone: string
          platform: string | null
          push_token: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          agency_id: string
          client_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          phone: string
          platform?: string | null
          push_token?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          agency_id?: string
          client_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          phone?: string
          platform?: string | null
          push_token?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_devices_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_devices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_requests: {
        Row: {
          agency_id: string
          case_id: string | null
          client_id: string | null
          destination: string | null
          email: string | null
          first_name: string
          goods: string | null
          handled_at: string | null
          handled_by: string | null
          id: string
          kind: string
          last_name: string
          locale: string
          note: string | null
          origin_city: string | null
          phone: string
          phone_verified: boolean
          portal_token: string
          received_at: string
          reference: string
          refusal_reason: string | null
          source_ip: unknown
          status: string
          travel_date: string | null
          visa_type_id: string | null
        }
        Insert: {
          agency_id: string
          case_id?: string | null
          client_id?: string | null
          destination?: string | null
          email?: string | null
          first_name: string
          goods?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind: string
          last_name: string
          locale?: string
          note?: string | null
          origin_city?: string | null
          phone: string
          phone_verified?: boolean
          portal_token?: string
          received_at?: string
          reference: string
          refusal_reason?: string | null
          source_ip?: unknown
          status?: string
          travel_date?: string | null
          visa_type_id?: string | null
        }
        Update: {
          agency_id?: string
          case_id?: string | null
          client_id?: string | null
          destination?: string | null
          email?: string | null
          first_name?: string
          goods?: string | null
          handled_at?: string | null
          handled_by?: string | null
          id?: string
          kind?: string
          last_name?: string
          locale?: string
          note?: string | null
          origin_city?: string | null
          phone?: string
          phone_verified?: boolean
          portal_token?: string
          received_at?: string
          reference?: string
          refusal_reason?: string | null
          source_ip?: unknown
          status?: string
          travel_date?: string | null
          visa_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_requests_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_visa_type_id_fkey"
            columns: ["visa_type_id"]
            isOneToOne: false
            referencedRelation: "visa_types"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          agency_id: string
          biometrics_at: string | null
          birth_date: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          employer: string | null
          first_name: string
          id: string
          last_name: string
          locale: string
          nationality: string | null
          native_name: string | null
          office_id: string | null
          partner_id: string | null
          passport_expiry: string | null
          passport_number: string | null
          phone: string
          phone_verified_at: string | null
          professional_status: string | null
          tags: string[]
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          agency_id: string
          biometrics_at?: string | null
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          employer?: string | null
          first_name: string
          id?: string
          last_name: string
          locale?: string
          nationality?: string | null
          native_name?: string | null
          office_id?: string | null
          partner_id?: string | null
          passport_expiry?: string | null
          passport_number?: string | null
          phone: string
          phone_verified_at?: string | null
          professional_status?: string | null
          tags?: string[]
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string
          biometrics_at?: string | null
          birth_date?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          employer?: string | null
          first_name?: string
          id?: string
          last_name?: string
          locale?: string
          nationality?: string | null
          native_name?: string | null
          office_id?: string | null
          partner_id?: string | null
          passport_expiry?: string | null
          passport_number?: string | null
          phone?: string
          phone_verified_at?: string | null
          professional_status?: string | null
          tags?: string[]
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          agency_id: string
          at: string
          channel: string
          client_id: string
          collected_by: string | null
          evidence_path: string | null
          granted: boolean
          id: string
          notice_version: string
          purpose: string
        }
        Insert: {
          agency_id: string
          at?: string
          channel: string
          client_id: string
          collected_by?: string | null
          evidence_path?: string | null
          granted: boolean
          id?: string
          notice_version: string
          purpose: string
        }
        Update: {
          agency_id?: string
          at?: string
          channel?: string
          client_id?: string
          collected_by?: string | null
          evidence_path?: string | null
          granted?: boolean
          id?: string
          notice_version?: string
          purpose?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consulates: {
        Row: {
          active: boolean
          agency_id: string
          announced_days: number | null
          appeal_checked_at: string | null
          appeal_days: number | null
          appeal_source: string | null
          centre: string
          city: string
          country: Json
          country_code: string
          created_at: string
          currency: string
          fee_consulate: number
          id: string
          notes: string | null
          ref_multi_entry: number | null
          ref_refusal_rate: number | null
          ref_year: number | null
          requires_residence: boolean
        }
        Insert: {
          active?: boolean
          agency_id: string
          announced_days?: number | null
          appeal_checked_at?: string | null
          appeal_days?: number | null
          appeal_source?: string | null
          centre?: string
          city: string
          country?: Json
          country_code: string
          created_at?: string
          currency?: string
          fee_consulate?: number
          id?: string
          notes?: string | null
          ref_multi_entry?: number | null
          ref_refusal_rate?: number | null
          ref_year?: number | null
          requires_residence?: boolean
        }
        Update: {
          active?: boolean
          agency_id?: string
          announced_days?: number | null
          appeal_checked_at?: string | null
          appeal_days?: number | null
          appeal_source?: string | null
          centre?: string
          city?: string
          country?: Json
          country_code?: string
          created_at?: string
          currency?: string
          fee_consulate?: number
          id?: string
          notes?: string | null
          ref_multi_entry?: number | null
          ref_refusal_rate?: number | null
          ref_year?: number | null
          requires_residence?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "consulates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_log: {
        Row: {
          actor_id: string | null
          actor_token: string | null
          agency_id: string
          at: string
          document_id: string | null
          document_kind: string
          id: string
          ip: unknown
        }
        Insert: {
          actor_id?: string | null
          actor_token?: string | null
          agency_id: string
          at?: string
          document_id?: string | null
          document_kind: string
          id?: string
          ip?: unknown
        }
        Update: {
          actor_id?: string | null
          actor_token?: string | null
          agency_id?: string
          at?: string
          document_id?: string | null
          document_kind?: string
          id?: string
          ip?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "document_access_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_log_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          agency_id: string
          archived: boolean
          body: Json
          category: string
          channel: string
          id: string
          key: string
          meta_template_ids: Json
          name: Json
          variables: string[]
        }
        Insert: {
          agency_id: string
          archived?: boolean
          body: Json
          category?: string
          channel?: string
          id?: string
          key: string
          meta_template_ids?: Json
          name: Json
          variables?: string[]
        }
        Update: {
          agency_id?: string
          archived?: boolean
          body?: Json
          category?: string
          channel?: string
          id?: string
          key?: string
          meta_template_ids?: Json
          name?: Json
          variables?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agency_id: string
          at: string
          author_id: string | null
          automated: boolean
          body: string
          case_id: string | null
          channel: string
          client_id: string | null
          direction: string
          error: string | null
          from_number: string | null
          id: string
          locale: string
          provider_id: string | null
          read_at: string | null
          shipment_id: string | null
          status: string
          status_at: string | null
          template_key: string | null
          wa_category: string | null
          wa_cost: number | null
          wa_currency: string | null
          wa_template_name: string | null
        }
        Insert: {
          agency_id: string
          at?: string
          author_id?: string | null
          automated?: boolean
          body: string
          case_id?: string | null
          channel?: string
          client_id?: string | null
          direction: string
          error?: string | null
          from_number?: string | null
          id?: string
          locale?: string
          provider_id?: string | null
          read_at?: string | null
          shipment_id?: string | null
          status?: string
          status_at?: string | null
          template_key?: string | null
          wa_category?: string | null
          wa_cost?: number | null
          wa_currency?: string | null
          wa_template_name?: string | null
        }
        Update: {
          agency_id?: string
          at?: string
          author_id?: string | null
          automated?: boolean
          body?: string
          case_id?: string | null
          channel?: string
          client_id?: string | null
          direction?: string
          error?: string | null
          from_number?: string | null
          id?: string
          locale?: string
          provider_id?: string | null
          read_at?: string | null
          shipment_id?: string | null
          status?: string
          status_at?: string | null
          template_key?: string | null
          wa_category?: string | null
          wa_cost?: number | null
          wa_currency?: string | null
          wa_template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "messages_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      offices: {
        Row: {
          active: boolean
          address: string | null
          agency_id: string
          city: string | null
          country: string
          country_code: string
          created_at: string
          id: string
          name: string
          phone: string | null
          timezone: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          agency_id: string
          city?: string | null
          country: string
          country_code: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          timezone?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          agency_id?: string
          city?: string | null
          country?: string
          country_code?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "offices_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_codes: {
        Row: {
          agency_id: string
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          max_attempts: number
          phone: string
          purpose: string
          source_ip: unknown
        }
        Insert: {
          agency_id: string
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          phone: string
          purpose?: string
          source_ip?: unknown
        }
        Update: {
          agency_id?: string
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          phone?: string
          purpose?: string
          source_ip?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "otp_codes_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_commissions: {
        Row: {
          agency_id: string
          amount: number
          case_id: string | null
          created_at: string
          currency: string
          id: string
          partner_id: string
          settled_at: string | null
          shipment_id: string | null
          state: string
        }
        Insert: {
          agency_id: string
          amount: number
          case_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          partner_id: string
          settled_at?: string | null
          shipment_id?: string | null
          state?: string
        }
        Update: {
          agency_id?: string
          amount?: number
          case_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          partner_id?: string
          settled_at?: string | null
          shipment_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_commissions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_commissions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_commissions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_commissions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "partner_commissions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          active: boolean
          agency_id: string
          commission_kind: string
          commission_value: number
          created_at: string
          email: string | null
          id: string
          name: string
          note: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean
          agency_id: string
          commission_kind?: string
          commission_value?: number
          created_at?: string
          email?: string | null
          id?: string
          name: string
          note?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean
          agency_id?: string
          commission_kind?: string
          commission_value?: number
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          note?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      passport_custody: {
        Row: {
          agency_id: string
          case_id: string | null
          client_id: string
          deposit_slip_path: string | null
          id: string
          location: string
          location_note: string | null
          passport_number: string
          received_at: string
          received_by: string | null
          return_slip_path: string | null
          returned_at: string | null
          returned_by: string | null
        }
        Insert: {
          agency_id: string
          case_id?: string | null
          client_id: string
          deposit_slip_path?: string | null
          id?: string
          location?: string
          location_note?: string | null
          passport_number: string
          received_at?: string
          received_by?: string | null
          return_slip_path?: string | null
          returned_at?: string | null
          returned_by?: string | null
        }
        Update: {
          agency_id?: string
          case_id?: string | null
          client_id?: string
          deposit_slip_path?: string | null
          id?: string
          location?: string
          location_note?: string | null
          passport_number?: string
          received_at?: string
          received_by?: string | null
          return_slip_path?: string | null
          returned_at?: string | null
          returned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "passport_custody_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_custody_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_custody_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_custody_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "passport_custody_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          agency_id: string
          amount: number
          at: string | null
          case_id: string | null
          cash_session_id: string | null
          client_id: string | null
          collected_by: string | null
          created_at: string
          currency: string
          due_at: string | null
          fx_rate: number
          id: string
          kind: string
          label: Json
          lot_id: string | null
          method: string | null
          office_id: string | null
          receipt_no: string | null
          shipment_id: string | null
          state: string
        }
        Insert: {
          agency_id: string
          amount: number
          at?: string | null
          case_id?: string | null
          cash_session_id?: string | null
          client_id?: string | null
          collected_by?: string | null
          created_at?: string
          currency?: string
          due_at?: string | null
          fx_rate?: number
          id?: string
          kind?: string
          label: Json
          lot_id?: string | null
          method?: string | null
          office_id?: string | null
          receipt_no?: string | null
          shipment_id?: string | null
          state?: string
        }
        Update: {
          agency_id?: string
          amount?: number
          at?: string | null
          case_id?: string | null
          cash_session_id?: string | null
          client_id?: string | null
          collected_by?: string | null
          created_at?: string
          currency?: string
          due_at?: string | null
          fx_rate?: number
          id?: string
          kind?: string
          label?: Json
          lot_id?: string | null
          method?: string | null
          office_id?: string | null
          receipt_no?: string | null
          shipment_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "shipment_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "payments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          agency_id: string
          created_at: string
          email: string | null
          id: string
          invited_by: string | null
          last_seen_at: string | null
          locale: string
          name: string
          office_id: string | null
          phone: string | null
          role: string
        }
        Insert: {
          active?: boolean
          agency_id: string
          created_at?: string
          email?: string | null
          id: string
          invited_by?: string | null
          last_seen_at?: string | null
          locale?: string
          name: string
          office_id?: string | null
          phone?: string | null
          role?: string
        }
        Update: {
          active?: boolean
          agency_id?: string
          created_at?: string
          email?: string | null
          id?: string
          invited_by?: string | null
          last_seen_at?: string | null
          locale?: string
          name?: string
          office_id?: string | null
          phone?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          subject: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          agency_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          case_id: string | null
          client_id: string | null
          currency: string
          id: string
          issued_at: string
          issued_by: string | null
          lines: Json
          number: string
          shipment_id: string | null
          storage_path: string | null
          total: number
        }
        Insert: {
          agency_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          case_id?: string | null
          client_id?: string | null
          currency?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          lines?: Json
          number: string
          shipment_id?: string | null
          storage_path?: string | null
          total?: number
        }
        Update: {
          agency_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          case_id?: string | null
          client_id?: string | null
          currency?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          lines?: Json
          number?: string
          shipment_id?: string | null
          storage_path?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "receipts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      reference_counters: {
        Row: {
          agency_id: string
          kind: string
          last: number
          year: number
        }
        Insert: {
          agency_id: string
          kind: string
          last?: number
          year: number
        }
        Update: {
          agency_id?: string
          kind?: string
          last?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "reference_counters_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_policies: {
        Row: {
          agency_id: string
          case_months: number
          last_run_at: string | null
          message_months: number
          shipment_months: number
        }
        Insert: {
          agency_id: string
          case_months?: number
          last_run_at?: string | null
          message_months?: number
          shipment_months?: number
        }
        Update: {
          agency_id?: string
          case_months?: number
          last_run_at?: string | null
          message_months?: number
          shipment_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "retention_policies_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_documents: {
        Row: {
          agency_id: string
          file_name: string | null
          id: string
          key: string
          label: Json
          lot_id: string | null
          received_at: string | null
          reminders: number
          required: boolean
          shipment_id: string
          state: string
          storage_path: string | null
        }
        Insert: {
          agency_id: string
          file_name?: string | null
          id?: string
          key: string
          label: Json
          lot_id?: string | null
          received_at?: string | null
          reminders?: number
          required?: boolean
          shipment_id: string
          state?: string
          storage_path?: string | null
        }
        Update: {
          agency_id?: string
          file_name?: string | null
          id?: string
          key?: string
          label?: Json
          lot_id?: string | null
          received_at?: string | null
          reminders?: number
          required?: boolean
          shipment_id?: string
          state?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_documents_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "shipment_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_documents_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_documents_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          agency_id: string
          at: string
          author_id: string | null
          id: string
          location: string | null
          note: Json | null
          shipment_id: string
          stage: string
        }
        Insert: {
          agency_id: string
          at?: string
          author_id?: string | null
          id?: string
          location?: string | null
          note?: Json | null
          shipment_id: string
          stage: string
        }
        Update: {
          agency_id?: string
          at?: string
          author_id?: string | null
          id?: string
          location?: string | null
          note?: Json | null
          shipment_id?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_finance: {
        Row: {
          agency_id: string
          customs_duty: number | null
          freight_cost: number
          freight_currency: string
          freight_fx: number
          local_charges: number | null
          note: string | null
          quoted_price: number | null
          shipment_id: string
        }
        Insert: {
          agency_id: string
          customs_duty?: number | null
          freight_cost?: number
          freight_currency?: string
          freight_fx?: number
          local_charges?: number | null
          note?: string | null
          quoted_price?: number | null
          shipment_id: string
        }
        Update: {
          agency_id?: string
          customs_duty?: number | null
          freight_cost?: number
          freight_currency?: string
          freight_fx?: number
          local_charges?: number | null
          note?: string | null
          quoted_price?: number | null
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_finance_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_finance_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_finance_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_lots: {
        Row: {
          agency_id: string
          cleared_at: string | null
          client_id: string
          declared_currency: string | null
          declared_value: number | null
          delivered_at: string | null
          goods: Json | null
          id: string
          marks: string | null
          note: string | null
          packages: number | null
          portal_token: string
          shipment_id: string
          volume_cbm: number | null
          weight_kg: number | null
        }
        Insert: {
          agency_id: string
          cleared_at?: string | null
          client_id: string
          declared_currency?: string | null
          declared_value?: number | null
          delivered_at?: string | null
          goods?: Json | null
          id?: string
          marks?: string | null
          note?: string | null
          packages?: number | null
          portal_token?: string
          shipment_id: string
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Update: {
          agency_id?: string
          cleared_at?: string | null
          client_id?: string
          declared_currency?: string | null
          declared_value?: number | null
          delivered_at?: string | null
          goods?: Json | null
          id?: string
          marks?: string | null
          note?: string | null
          packages?: number | null
          portal_token?: string
          shipment_id?: string
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_lots_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lots_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_lots_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          agency_id: string
          arrived_at: string | null
          assignee_id: string | null
          bl_number: string | null
          blocked_reason: string | null
          blocked_since: string | null
          broker_name: string | null
          broker_phone: string | null
          cleared_at: string | null
          consolidated: boolean
          container_no: string | null
          country_from: string | null
          country_to: string | null
          created_at: string
          delivered_at: string | null
          demurrage_currency: string | null
          demurrage_rate: number | null
          dest_city: string | null
          dest_port: string | null
          eta: string | null
          etd: string | null
          free_days: number
          goods: Json | null
          id: string
          incoterm: string | null
          mode: string
          office_id: string | null
          origin_city: string | null
          origin_port: string | null
          packages: number | null
          portal_token: string
          reference: string
          stage: string
          status: string
          supplier: string | null
          vessel: string | null
          volume_cbm: number | null
          weight_kg: number | null
        }
        Insert: {
          agency_id: string
          arrived_at?: string | null
          assignee_id?: string | null
          bl_number?: string | null
          blocked_reason?: string | null
          blocked_since?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          cleared_at?: string | null
          consolidated?: boolean
          container_no?: string | null
          country_from?: string | null
          country_to?: string | null
          created_at?: string
          delivered_at?: string | null
          demurrage_currency?: string | null
          demurrage_rate?: number | null
          dest_city?: string | null
          dest_port?: string | null
          eta?: string | null
          etd?: string | null
          free_days?: number
          goods?: Json | null
          id?: string
          incoterm?: string | null
          mode: string
          office_id?: string | null
          origin_city?: string | null
          origin_port?: string | null
          packages?: number | null
          portal_token?: string
          reference: string
          stage?: string
          status?: string
          supplier?: string | null
          vessel?: string | null
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Update: {
          agency_id?: string
          arrived_at?: string | null
          assignee_id?: string | null
          bl_number?: string | null
          blocked_reason?: string | null
          blocked_since?: string | null
          broker_name?: string | null
          broker_phone?: string | null
          cleared_at?: string | null
          consolidated?: boolean
          container_no?: string | null
          country_from?: string | null
          country_to?: string | null
          created_at?: string
          delivered_at?: string | null
          demurrage_currency?: string | null
          demurrage_rate?: number | null
          dest_city?: string | null
          dest_port?: string | null
          eta?: string | null
          etd?: string | null
          free_days?: number
          goods?: Json | null
          id?: string
          incoterm?: string | null
          mode?: string
          office_id?: string | null
          origin_city?: string | null
          origin_port?: string | null
          packages?: number | null
          portal_token?: string
          reference?: string
          stage?: string
          status?: string
          supplier?: string | null
          vessel?: string | null
          volume_cbm?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_attempts: {
        Row: {
          agency_id: string
          at: string
          by_id: string | null
          case_id: string | null
          centre: string
          consulate_id: string
          id: string
          note: string | null
          result: string
          slot_at: string | null
        }
        Insert: {
          agency_id: string
          at?: string
          by_id?: string | null
          case_id?: string | null
          centre: string
          consulate_id: string
          id?: string
          note?: string | null
          result: string
          slot_at?: string | null
        }
        Update: {
          agency_id?: string
          at?: string
          by_id?: string | null
          case_id?: string | null
          centre?: string
          consulate_id?: string
          id?: string
          note?: string | null
          result?: string
          slot_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slot_attempts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_attempts_by_id_fkey"
            columns: ["by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_attempts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_attempts_consulate_id_fkey"
            columns: ["consulate_id"]
            isOneToOne: false
            referencedRelation: "consulates"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_definitions: {
        Row: {
          agency_id: string
          domain: string
          id: string
          key: string
          label: Json
          position: number
          terminal: boolean
        }
        Insert: {
          agency_id: string
          domain: string
          id?: string
          key: string
          label: Json
          position: number
          terminal?: boolean
        }
        Update: {
          agency_id?: string
          domain?: string
          id?: string
          key?: string
          label?: Json
          position?: number
          terminal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "stage_definitions_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agency_id: string
          assignee_id: string | null
          automated: boolean
          case_id: string | null
          created_at: string
          created_by: string | null
          done: boolean
          done_at: string | null
          due_at: string | null
          id: string
          shipment_id: string | null
          title: Json
        }
        Insert: {
          agency_id: string
          assignee_id?: string | null
          automated?: boolean
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          id?: string
          shipment_id?: string | null
          title: Json
        }
        Update: {
          agency_id?: string
          assignee_id?: string | null
          automated?: boolean
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          id?: string
          shipment_id?: string | null
          title?: Json
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "tasks_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      visa_types: {
        Row: {
          active: boolean
          agency_id: string
          category: string
          checklist_id: string | null
          country: Json
          country_code: string
          created_at: string
          currency: string
          fee_agency: number
          fee_consulate: number
          id: string
          label: Json
          processing_days: number
        }
        Insert: {
          active?: boolean
          agency_id: string
          category?: string
          checklist_id?: string | null
          country: Json
          country_code: string
          created_at?: string
          currency?: string
          fee_agency?: number
          fee_consulate?: number
          id?: string
          label: Json
          processing_days?: number
        }
        Update: {
          active?: boolean
          agency_id?: string
          category?: string
          checklist_id?: string | null
          country?: Json
          country_code?: string
          created_at?: string
          currency?: string
          fee_agency?: number
          fee_consulate?: number
          id?: string
          label?: Json
          processing_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "visa_types_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visa_types_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_accounts: {
        Row: {
          active: boolean
          agency_id: string
          app_secret_name: string | null
          created_at: string
          display_number: string | null
          last_error: string | null
          last_error_at: string | null
          linked_at: string | null
          phone_number_id: string
          token_secret: string
          verify_token: string
          waba_id: string | null
        }
        Insert: {
          active?: boolean
          agency_id: string
          app_secret_name?: string | null
          created_at?: string
          display_number?: string | null
          last_error?: string | null
          last_error_at?: string | null
          linked_at?: string | null
          phone_number_id: string
          token_secret: string
          verify_token: string
          waba_id?: string | null
        }
        Update: {
          active?: boolean
          agency_id?: string
          app_secret_name?: string | null
          created_at?: string
          display_number?: string | null
          last_error?: string | null
          last_error_at?: string | null
          linked_at?: string | null
          phone_number_id?: string
          token_secret?: string
          verify_token?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_accounts_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: true
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          agency_id: string
          category: string
          id: string
          language: string
          meta_name: string
          rejected_reason: string | null
          reviewed_at: string | null
          status: string
          submitted_at: string | null
          template_id: string | null
          variables: string[]
        }
        Insert: {
          agency_id: string
          category?: string
          id?: string
          language: string
          meta_name: string
          rejected_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string | null
          template_id?: string | null
          variables?: string[]
        }
        Update: {
          agency_id?: string
          category?: string
          id?: string
          language?: string
          meta_name?: string
          rejected_reason?: string | null
          reviewed_at?: string | null
          status?: string
          submitted_at?: string | null
          template_id?: string | null
          variables?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_unmatched: {
        Row: {
          agency_id: string
          at: string
          body: string | null
          client_id: string | null
          from_number: string
          id: string
          profile_name: string | null
          provider_id: string | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          agency_id: string
          at?: string
          body?: string | null
          client_id?: string | null
          from_number: string
          id?: string
          profile_name?: string | null
          provider_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          agency_id?: string
          at?: string
          body?: string | null
          client_id?: string | null
          from_number?: string
          id?: string
          profile_name?: string | null
          provider_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_unmatched_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_unmatched_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_unmatched_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      revenue_lines: {
        Row: {
          agency_id: string | null
          amount: number | null
          amount_agency_currency: number | null
          at: string | null
          case_id: string | null
          cash_session_id: string | null
          client_id: string | null
          collected_by: string | null
          created_at: string | null
          currency: string | null
          due_at: string | null
          fx_rate: number | null
          id: string | null
          kind: string | null
          label: Json | null
          lot_id: string | null
          method: string | null
          office_id: string | null
          receipt_no: string | null
          shipment_id: string | null
          state: string | null
        }
        Insert: {
          agency_id?: string | null
          amount?: number | null
          amount_agency_currency?: never
          at?: string | null
          case_id?: string | null
          cash_session_id?: string | null
          client_id?: string | null
          collected_by?: string | null
          created_at?: string | null
          currency?: string | null
          due_at?: string | null
          fx_rate?: number | null
          id?: string | null
          kind?: string | null
          label?: Json | null
          lot_id?: string | null
          method?: string | null
          office_id?: string | null
          receipt_no?: string | null
          shipment_id?: string | null
          state?: string | null
        }
        Update: {
          agency_id?: string | null
          amount?: number | null
          amount_agency_currency?: never
          at?: string | null
          case_id?: string | null
          cash_session_id?: string | null
          client_id?: string | null
          collected_by?: string | null
          created_at?: string | null
          currency?: string | null
          due_at?: string | null
          fx_rate?: number | null
          id?: string | null
          kind?: string | null
          label?: Json | null
          lot_id?: string | null
          method?: string | null
          office_id?: string | null
          receipt_no?: string | null
          shipment_id?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_collected_by_fkey"
            columns: ["collected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "shipment_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_office_id_fkey"
            columns: ["office_id"]
            isOneToOne: false
            referencedRelation: "offices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "payments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_demurrage: {
        Row: {
          agency_id: string | null
          amount: number | null
          arrived_at: string | null
          currency: string | null
          free_days: number | null
          overdue_days: number | null
          reference: string | null
          shipment_id: string | null
        }
        Insert: {
          agency_id?: string | null
          amount?: never
          arrived_at?: string | null
          currency?: string | null
          free_days?: number | null
          overdue_days?: never
          reference?: string | null
          shipment_id?: string | null
        }
        Update: {
          agency_id?: string | null
          amount?: never
          arrived_at?: string | null
          currency?: string | null
          free_days?: number | null
          overdue_days?: never
          reference?: string | null
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_margin: {
        Row: {
          agency_id: string | null
          margin: number | null
          shipment_id: string | null
        }
        Insert: {
          agency_id?: string | null
          margin?: never
          shipment_id?: string | null
        }
        Update: {
          agency_id?: string | null
          margin?: never
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_finance_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_finance_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipment_demurrage"
            referencedColumns: ["shipment_id"]
          },
          {
            foreignKeyName: "shipment_finance_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: true
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_automation: {
        Args: {
          c: Database["public"]["Tables"]["cases"]["Row"]
          r: Database["public"]["Tables"]["automation_rules"]["Row"]
        }
        Returns: undefined
      }
      auth_agency_id: { Args: never; Returns: string }
      auth_can: { Args: { capability: string }; Returns: boolean }
      auth_office_id: { Args: never; Returns: string }
      auth_role: { Args: never; Returns: string }
      auth_sees_office: { Args: { target: string }; Returns: boolean }
      automation_matches: {
        Args: {
          c: Database["public"]["Tables"]["cases"]["Row"]
          r: Database["public"]["Tables"]["automation_rules"]["Row"]
        }
        Returns: boolean
      }
      collect_payment: {
        Args: { p_method: string; p_payment: string; p_session?: string }
        Returns: undefined
      }
      convert_request: {
        Args: { p_assignee: string; p_request: string }
        Returns: string
      }
      current_checklist_version: {
        Args: { p_checklist: string }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      demurrage_days: { Args: { p_shipment: string }; Returns: number }
      issue_otp: {
        Args: { p_agency_slug: string; p_phone: string; p_purpose?: string }
        Returns: Json
      }
      next_reference: {
        Args: { p_agency: string; p_kind: string }
        Returns: string
      }
      open_case: {
        Args: {
          p_assignee: string
          p_client: string
          p_group?: string
          p_source: string
          p_travel: string
          p_visa_type: string
        }
        Returns: string
      }
      portal_case: { Args: { p_token: string }; Returns: Json }
      portal_mine: {
        Args: { p_agency_slug: string; p_device_token: string }
        Returns: Json
      }
      portal_queue: {
        Args: { p_token: string }
        Returns: {
          city: string
          country: Json
          rank: number
          total: number
          wait_days: number
        }[]
      }
      portal_shipment: { Args: { p_token: string }; Returns: Json }
      portal_submit_request: {
        Args: {
          p_agency_slug: string
          p_first: string
          p_goods: string
          p_kind: string
          p_last: string
          p_locale: string
          p_note: string
          p_origin: string
          p_phone: string
          p_travel: string
          p_verified: boolean
          p_visa_type: string
        }
        Returns: Json
      }
      provision_agency: {
        Args: {
          p_country: string
          p_locale: string
          p_name: string
          p_owner_email: string
          p_owner_name: string
          p_owner_phone: string
          p_services: string[]
          p_slug: string
        }
        Returns: Json
      }
      purge_expired: { Args: { p_agency: string }; Returns: number }
      queue_rank: {
        Args: { p_case: string }
        Returns: {
          consulate_id: string
          joined_at: string
          rank: number
          total: number
        }[]
      }
      rate_allow: {
        Args: {
          p_bucket: string
          p_limit: number
          p_subject: string
          p_window: string
        }
        Returns: boolean
      }
      real_wait_days: { Args: { p_consulate: string }; Returns: number }
      record_decision: {
        Args: {
          p_case: string
          p_code?: string
          p_reason?: string
          p_status: string
        }
        Returns: undefined
      }
      release_passport: {
        Args: { p_custody: string; p_force?: boolean }
        Returns: undefined
      }
      run_automations: {
        Args: { p_agency: string; p_dry_run?: boolean }
        Returns: Json
      }
      seed_catalogue: {
        Args: { p_agency: string; p_services: string[] }
        Returns: undefined
      }
      serve_queue: {
        Args: { p_entry: string; p_location?: string; p_slot_at: string }
        Returns: string
      }
      slug_available: { Args: { p_slug: string }; Returns: boolean }
      storage_agency: { Args: { name: string }; Returns: string }
      vault_read: { Args: { p_name: string }; Returns: string }
      verify_otp: {
        Args: {
          p_agency_slug: string
          p_code: string
          p_phone: string
          p_platform?: string
        }
        Returns: Json
      }
      wa_latest_case: { Args: { p_client: string }; Returns: string }
      wa_match_client: {
        Args: { p_agency: string; p_number: string }
        Returns: string[]
      }
      wa_outbox: {
        Args: { p_agency: string; p_limit?: number }
        Returns: {
          body: string
          category: string
          client_id: string
          id: string
          in_window: boolean
          locale: string
          template_name: string
          to_number: string
        }[]
      }
      wa_receive: {
        Args: {
          p_agency: string
          p_body: string
          p_from: string
          p_profile_name?: string
          p_provider_id: string
        }
        Returns: string
      }
      wa_status: {
        Args: {
          p_cost?: number
          p_currency?: string
          p_error?: string
          p_provider_id: string
          p_status: string
        }
        Returns: undefined
      }
      wa_window_open: { Args: { p_client: string }; Returns: boolean }
      whatsapp_window_open: { Args: { p_client: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
