/* eslint-disable */
// AUTO-GENERATED — DO NOT EDIT
// Run migrations to regenerate.

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
      ex_allocations: {
        Row: {
          amount: number
          id: string
          org_id: string
          payment_id: string
          reimbursement_id: string
        }
        Insert: {
          amount: number
          id?: string
          org_id: string
          payment_id: string
          reimbursement_id: string
        }
        Update: {
          amount?: number
          id?: string
          org_id?: string
          payment_id?: string
          reimbursement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_allocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "ex_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_allocations_reimbursement_id_fkey"
            columns: ["reimbursement_id"]
            isOneToOne: false
            referencedRelation: "ex_reimbursements"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_attachments: {
        Row: {
          archive_reason: string
          archived_at: string | null
          archived_by: string | null
          expenditure_id: string | null
          file_name: string
          id: string
          mime_type: string
          org_id: string
          payment_id: string | null
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          archive_reason?: string
          archived_at?: string | null
          archived_by?: string | null
          expenditure_id?: string | null
          file_name: string
          id?: string
          mime_type: string
          org_id: string
          payment_id?: string | null
          size_bytes: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          archive_reason?: string
          archived_at?: string | null
          archived_by?: string | null
          expenditure_id?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          org_id?: string
          payment_id?: string | null
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ex_attachments_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_attachments_expenditure_id_fkey"
            columns: ["expenditure_id"]
            isOneToOne: false
            referencedRelation: "ex_expenditures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_attachments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "ex_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          kind: string
          name: string
          org_id: string
          sort: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          name: string
          org_id: string
          sort?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          kind?: string
          name?: string
          org_id?: string
          sort?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_counters: {
        Row: {
          kind: string
          last: number
          org_id: string
        }
        Insert: {
          kind: string
          last?: number
          org_id: string
        }
        Update: {
          kind?: string
          last?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_expenditures: {
        Row: {
          account_label: string
          agency_id: string | null
          agency_invoice_id: string | null
          amount: number
          archive_reason: string
          archived_at: string | null
          archived_by: string | null
          category_id: string
          client_recovery_flag: string
          code: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          duplicate_note: string
          duplicate_reviewed_at: string | null
          duplicate_reviewed_by: string | null
          id: string
          invoice_ref: string
          notes: string
          org_id: string
          paid_by: string
          payer_name: string
          payer_worker_id: string | null
          payment_method: string
          person_reimb_flag: string
          placement_id: string | null
          property_id: string | null
          property_name: string
          purpose: string
          spent_on: string
          tax_amount: number | null
          updated_at: string
          updated_by: string | null
          vendor: string
        }
        Insert: {
          account_label?: string
          agency_id?: string | null
          agency_invoice_id?: string | null
          amount: number
          archive_reason?: string
          archived_at?: string | null
          archived_by?: string | null
          category_id: string
          client_recovery_flag?: string
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          duplicate_note?: string
          duplicate_reviewed_at?: string | null
          duplicate_reviewed_by?: string | null
          id?: string
          invoice_ref?: string
          notes?: string
          org_id: string
          paid_by: string
          payer_name?: string
          payer_worker_id?: string | null
          payment_method: string
          person_reimb_flag?: string
          placement_id?: string | null
          property_id?: string | null
          property_name?: string
          purpose?: string
          spent_on: string
          tax_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor: string
        }
        Update: {
          account_label?: string
          agency_id?: string | null
          agency_invoice_id?: string | null
          amount?: number
          archive_reason?: string
          archived_at?: string | null
          archived_by?: string | null
          category_id?: string
          client_recovery_flag?: string
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          duplicate_note?: string
          duplicate_reviewed_at?: string | null
          duplicate_reviewed_by?: string | null
          id?: string
          invoice_ref?: string
          notes?: string
          org_id?: string
          paid_by?: string
          payer_name?: string
          payer_worker_id?: string | null
          payment_method?: string
          person_reimb_flag?: string
          placement_id?: string | null
          property_id?: string | null
          property_name?: string
          purpose?: string
          spent_on?: string
          tax_amount?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_expenditures_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "wf_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_agency_invoice_id_fkey"
            columns: ["agency_invoice_id"]
            isOneToOne: false
            referencedRelation: "wf_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ex_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_duplicate_reviewed_by_fkey"
            columns: ["duplicate_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_payer_worker_id_fkey"
            columns: ["payer_worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_expenditures_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_history: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          after: Json | null
          before: Json | null
          changed_fields: string[]
          created_at: string
          expenditure_id: string | null
          id: number
          org_id: string
          payment_id: string | null
          reimbursement_id: string | null
          summary: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          after?: Json | null
          before?: Json | null
          changed_fields?: string[]
          created_at?: string
          expenditure_id?: string | null
          id?: never
          org_id: string
          payment_id?: string | null
          reimbursement_id?: string | null
          summary?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          after?: Json | null
          before?: Json | null
          changed_fields?: string[]
          created_at?: string
          expenditure_id?: string | null
          id?: never
          org_id?: string
          payment_id?: string | null
          reimbursement_id?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_payment_reversals: {
        Row: {
          org_id: string
          payment_id: string
          reason: string
          reversed_at: string
          reversed_by: string | null
        }
        Insert: {
          org_id: string
          payment_id: string
          reason: string
          reversed_at?: string
          reversed_by?: string | null
        }
        Update: {
          org_id?: string
          payment_id?: string
          reason?: string
          reversed_at?: string
          reversed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ex_payment_reversals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_payment_reversals_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "ex_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_payment_reversals_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_payments: {
        Row: {
          amount: number
          code: string
          currency: string
          direction: string
          id: string
          method: string
          notes: string
          org_id: string
          paid_on: string
          party_name: string
          recorded_at: string
          recorded_by: string | null
          reference: string
        }
        Insert: {
          amount: number
          code: string
          currency: string
          direction: string
          id?: string
          method: string
          notes?: string
          org_id: string
          paid_on: string
          party_name: string
          recorded_at?: string
          recorded_by?: string | null
          reference?: string
        }
        Update: {
          amount?: number
          code?: string
          currency?: string
          direction?: string
          id?: string
          method?: string
          notes?: string
          org_id?: string
          paid_on?: string
          party_name?: string
          recorded_at?: string
          recorded_by?: string | null
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_reimbursements: {
        Row: {
          agency_invoice_id: string | null
          approved_amount: number | null
          code: string
          created_at: string
          created_by: string | null
          direction: string
          due_on: string | null
          expenditure_id: string
          id: string
          invoice_ref: string
          notes: string
          org_id: string
          party_agency_id: string | null
          party_name: string
          party_property_id: string | null
          party_type: string
          party_worker_id: string | null
          requested_amount: number
          requested_on: string
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_invoice_id?: string | null
          approved_amount?: number | null
          code: string
          created_at?: string
          created_by?: string | null
          direction: string
          due_on?: string | null
          expenditure_id: string
          id?: string
          invoice_ref?: string
          notes?: string
          org_id: string
          party_agency_id?: string | null
          party_name: string
          party_property_id?: string | null
          party_type: string
          party_worker_id?: string | null
          requested_amount: number
          requested_on?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_invoice_id?: string | null
          approved_amount?: number | null
          code?: string
          created_at?: string
          created_by?: string | null
          direction?: string
          due_on?: string | null
          expenditure_id?: string
          id?: string
          invoice_ref?: string
          notes?: string
          org_id?: string
          party_agency_id?: string | null
          party_name?: string
          party_property_id?: string | null
          party_type?: string
          party_worker_id?: string | null
          requested_amount?: number
          requested_on?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ex_reimbursements_agency_invoice_id_fkey"
            columns: ["agency_invoice_id"]
            isOneToOne: false
            referencedRelation: "wf_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_expenditure_id_fkey"
            columns: ["expenditure_id"]
            isOneToOne: false
            referencedRelation: "ex_expenditures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_party_agency_id_fkey"
            columns: ["party_agency_id"]
            isOneToOne: false
            referencedRelation: "wf_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_party_property_id_fkey"
            columns: ["party_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_party_worker_id_fkey"
            columns: ["party_worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_reimbursements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ex_shift_links: {
        Row: {
          created_at: string
          expenditure_id: string
          org_id: string
          shift_id: string
        }
        Insert: {
          created_at?: string
          expenditure_id: string
          org_id: string
          shift_id: string
        }
        Update: {
          created_at?: string
          expenditure_id?: string
          org_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ex_shift_links_expenditure_id_fkey"
            columns: ["expenditure_id"]
            isOneToOne: false
            referencedRelation: "ex_expenditures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_shift_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ex_shift_links_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          retention_days: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          retention_days?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          retention_days?: number | null
        }
        Relationships: []
      }
      password_reset_requests: {
        Row: {
          created_at: string
          email: string
          id: number
        }
        Insert: {
          created_at?: string
          email: string
          id?: number
        }
        Update: {
          created_at?: string
          email?: string
          id?: number
        }
        Relationships: []
      }
      patrols: {
        Row: {
          areas: string[]
          created_at: string
          date_time: string
          geofence_distance_m: number | null
          id: string
          latitude: number | null
          location_accuracy_m: number | null
          logged_by: string | null
          longitude: number | null
          notes: string
          officer_name: string
          org_id: string
          photos: string[]
          property_id: string
          status: string
        }
        Insert: {
          areas?: string[]
          created_at?: string
          date_time: string
          geofence_distance_m?: number | null
          id?: string
          latitude?: number | null
          location_accuracy_m?: number | null
          logged_by?: string | null
          longitude?: number | null
          notes?: string
          officer_name: string
          org_id?: string
          photos?: string[]
          property_id: string
          status?: string
        }
        Update: {
          areas?: string[]
          created_at?: string
          date_time?: string
          geofence_distance_m?: number | null
          id?: string
          latitude?: number | null
          location_accuracy_m?: number | null
          logged_by?: string | null
          longitude?: number | null
          notes?: string
          officer_name?: string
          org_id?: string
          photos?: string[]
          property_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "patrols_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrols_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          field_guide_acknowledged_at: string | null
          full_name: string
          id: string
          org_id: string
          role: string
          terms_accepted_at: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          field_guide_acknowledged_at?: string | null
          full_name: string
          id: string
          org_id: string
          role?: string
          terms_accepted_at?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          field_guide_acknowledged_at?: string | null
          full_name?: string
          id?: string
          org_id?: string
          role?: string
          terms_accepted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          contact_email: string
          contact_name: string
          contact_phone: string
          created_at: string
          created_by: string | null
          geofence_enabled: boolean
          geofence_lat: number | null
          geofence_lng: number | null
          geofence_radius_m: number | null
          id: string
          image_path: string | null
          name: string
          notes: string
          org_id: string
          patrol_interval_minutes: number
        }
        Insert: {
          address?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          created_by?: string | null
          geofence_enabled?: boolean
          geofence_lat?: number | null
          geofence_lng?: number | null
          geofence_radius_m?: number | null
          id?: string
          image_path?: string | null
          name: string
          notes?: string
          org_id?: string
          patrol_interval_minutes?: number
        }
        Update: {
          address?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          created_at?: string
          created_by?: string | null
          geofence_enabled?: boolean
          geofence_lat?: number | null
          geofence_lng?: number | null
          geofence_radius_m?: number | null
          id?: string
          image_path?: string | null
          name?: string
          notes?: string
          org_id?: string
          patrol_interval_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "properties_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_payments: {
        Row: {
          org_id: string
          paid_at: string
          paid_by: string | null
          shift_id: string
        }
        Insert: {
          org_id?: string
          paid_at?: string
          paid_by?: string | null
          shift_id: string
        }
        Update: {
          org_id?: string
          paid_at?: string
          paid_by?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payments_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_payments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          created_at: string
          created_by: string | null
          end_time: string
          id: string
          notes: string
          org_id: string
          property_id: string
          shift_date: string
          staff_id: string
          start_time: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_time: string
          id?: string
          notes?: string
          org_id?: string
          property_id: string
          shift_date: string
          staff_id: string
          start_time: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_time?: string
          id?: string
          notes?: string
          org_id?: string
          property_id?: string
          shift_date?: string
          staff_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          profile_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id?: string
          profile_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          admin_note: string
          approved_at: string | null
          approved_by: string | null
          clock_in: string
          clock_out: string | null
          created_at: string
          edited: boolean
          employee_note: string
          id: string
          org_id: string
          profile_id: string | null
          property_id: string | null
          source: string
          status: string
          updated_at: string
          worker_name: string
        }
        Insert: {
          admin_note?: string
          approved_at?: string | null
          approved_by?: string | null
          clock_in: string
          clock_out?: string | null
          created_at?: string
          edited?: boolean
          employee_note?: string
          id?: string
          org_id: string
          profile_id?: string | null
          property_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          worker_name?: string
        }
        Update: {
          admin_note?: string
          approved_at?: string | null
          approved_by?: string | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string
          edited?: boolean
          employee_note?: string
          id?: string
          org_id?: string
          profile_id?: string | null
          property_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entry_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          created_at: string
          detail: Json
          entry_id: string | null
          id: number
          org_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          detail?: Json
          entry_id?: string | null
          id?: number
          org_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          detail?: Json
          entry_id?: string | null
          id?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entry_log_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entry_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_notes: {
        Row: {
          author_id: string | null
          author_name: string
          content: string
          created_at: string
          id: string
          org_id: string
          resolved_at: string | null
        }
        Insert: {
          author_id?: string | null
          author_name: string
          content: string
          created_at?: string
          id?: string
          org_id?: string
          resolved_at?: string | null
        }
        Update: {
          author_id?: string | null
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          org_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "watch_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_agencies: {
        Row: {
          account_number: string
          active: boolean
          address: string
          after_hours_contact: string
          after_hours_phone: string
          archived_at: string | null
          archived_by: string | null
          billing_contact: string
          billing_email: string
          billing_phone: string
          created_at: string
          created_by: string | null
          email: string
          id: string
          name: string
          notes: string
          org_id: string
          payment_terms: string
          phone: string
          primary_contact: string
          updated_at: string
        }
        Insert: {
          account_number?: string
          active?: boolean
          address?: string
          after_hours_contact?: string
          after_hours_phone?: string
          archived_at?: string | null
          archived_by?: string | null
          billing_contact?: string
          billing_email?: string
          billing_phone?: string
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          name: string
          notes?: string
          org_id?: string
          payment_terms?: string
          phone?: string
          primary_contact?: string
          updated_at?: string
        }
        Update: {
          account_number?: string
          active?: boolean
          address?: string
          after_hours_contact?: string
          after_hours_phone?: string
          archived_at?: string | null
          archived_by?: string | null
          billing_contact?: string
          billing_email?: string
          billing_phone?: string
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          name?: string
          notes?: string
          org_id?: string
          payment_terms?: string
          phone?: string
          primary_contact?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_agencies_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_agencies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_agencies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          changed_fields: string[]
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          meta: Json
          org_id: string
          required_perm: string
          summary: string
          worker_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          changed_fields?: string[]
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          meta?: Json
          org_id: string
          required_perm?: string
          summary?: string
          worker_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          changed_fields?: string[]
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          meta?: Json
          org_id?: string
          required_perm?: string
          summary?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wf_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_checklist_items: {
        Row: {
          completed_on: string | null
          created_at: string
          document_id: string | null
          id: string
          kind: string
          notes: string
          org_id: string
          placement_id: string | null
          required: boolean
          responsible_id: string | null
          sort: number
          status: string
          template_id: string | null
          title: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          completed_on?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          kind: string
          notes?: string
          org_id?: string
          placement_id?: string | null
          required?: boolean
          responsible_id?: string | null
          sort?: number
          status?: string
          template_id?: string | null
          title: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          completed_on?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          kind?: string
          notes?: string
          org_id?: string
          placement_id?: string | null
          required?: boolean
          responsible_id?: string | null
          sort?: number
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_checklist_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "wf_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_checklist_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_checklist_items_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_checklist_items_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "wf_requirement_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_checklist_items_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_document_versions: {
        Row: {
          document_id: string
          file_name: string
          id: string
          mime_type: string
          org_id: string
          review_notes: string
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          document_id: string
          file_name: string
          id?: string
          mime_type: string
          org_id: string
          review_notes?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
          version: number
        }
        Update: {
          document_id?: string
          file_name?: string
          id?: string
          mime_type?: string
          org_id?: string
          review_notes?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "wf_document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "wf_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_document_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_document_versions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_document_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_documents: {
        Row: {
          agency_id: string | null
          archived_at: string | null
          archived_by: string | null
          category: string
          classification: string
          created_at: string
          created_by: string | null
          current_version: number
          expiration_date: string | null
          id: string
          invoice_id: string | null
          issue_date: string | null
          org_id: string
          owner_type: string
          personnel_record_id: string | null
          placement_id: string | null
          signed: boolean
          title: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          agency_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category: string
          classification?: string
          created_at?: string
          created_by?: string | null
          current_version?: number
          expiration_date?: string | null
          id?: string
          invoice_id?: string | null
          issue_date?: string | null
          org_id?: string
          owner_type: string
          personnel_record_id?: string | null
          placement_id?: string | null
          signed?: boolean
          title: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          agency_id?: string | null
          archived_at?: string | null
          archived_by?: string | null
          category?: string
          classification?: string
          created_at?: string
          created_by?: string | null
          current_version?: number
          expiration_date?: string | null
          id?: string
          invoice_id?: string | null
          issue_date?: string | null
          org_id?: string
          owner_type?: string
          personnel_record_id?: string | null
          placement_id?: string | null
          signed?: boolean
          title?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wf_documents_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "wf_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "wf_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_personnel_record_id_fkey"
            columns: ["personnel_record_id"]
            isOneToOne: false
            referencedRelation: "wf_personnel_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_documents_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_employment: {
        Row: {
          access_review_note: string
          access_reviewed_at: string | null
          employment_type: string
          end_date: string | null
          files_archived_at: string | null
          notes: string
          org_id: string
          separation_notes: string
          separation_reason: string
          start_date: string | null
          supervisor: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          access_review_note?: string
          access_reviewed_at?: string | null
          employment_type?: string
          end_date?: string | null
          files_archived_at?: string | null
          notes?: string
          org_id?: string
          separation_notes?: string
          separation_reason?: string
          start_date?: string | null
          supervisor?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          access_review_note?: string
          access_reviewed_at?: string | null
          employment_type?: string
          end_date?: string | null
          files_archived_at?: string | null
          notes?: string
          org_id?: string
          separation_notes?: string
          separation_reason?: string
          start_date?: string | null
          supervisor?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_employment_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_employment_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: true
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_equipment: {
        Row: {
          asset_number: string
          condition_issued: string
          condition_returned: string
          created_at: string
          id: string
          issued_by: string | null
          issued_on: string | null
          item_name: string
          item_type: string
          notes: string
          org_id: string
          ownership: string
          placement_id: string | null
          quantity: number
          returned_on: string | null
          status: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          asset_number?: string
          condition_issued?: string
          condition_returned?: string
          created_at?: string
          id?: string
          issued_by?: string | null
          issued_on?: string | null
          item_name: string
          item_type: string
          notes?: string
          org_id?: string
          ownership?: string
          placement_id?: string | null
          quantity?: number
          returned_on?: string | null
          status?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          asset_number?: string
          condition_issued?: string
          condition_returned?: string
          created_at?: string
          id?: string
          issued_by?: string | null
          issued_on?: string | null
          item_name?: string
          item_type?: string
          notes?: string
          org_id?: string
          ownership?: string
          placement_id?: string | null
          quantity?: number
          returned_on?: string | null
          status?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_equipment_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_equipment_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_equipment_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_equipment_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_invoice_lines: {
        Row: {
          amount: number
          created_at: string
          description: string
          hours: number | null
          id: string
          invoice_id: string
          line_type: string
          org_id: string
          placement_id: string | null
          rate: number | null
          service_end: string | null
          service_start: string | null
          worker_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          description?: string
          hours?: number | null
          id?: string
          invoice_id: string
          line_type?: string
          org_id?: string
          placement_id?: string | null
          rate?: number | null
          service_end?: string | null
          service_start?: string | null
          worker_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          hours?: number | null
          id?: string
          invoice_id?: string
          line_type?: string
          org_id?: string
          placement_id?: string | null
          rate?: number | null
          service_end?: string | null
          service_start?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wf_invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "wf_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_invoice_lines_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_invoice_lines_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_invoices: {
        Row: {
          agency_id: string
          archived_at: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          invoice_date: string | null
          invoice_number: string
          org_id: string
          paid_on: string | null
          payment_ref: string
          period_end: string | null
          period_start: string | null
          review_notes: string
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          agency_id: string
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number: string
          org_id?: string
          paid_on?: string | null
          payment_ref?: string
          period_end?: string | null
          period_start?: string | null
          review_notes?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          agency_id?: string
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string
          org_id?: string
          paid_on?: string | null
          payment_ref?: string
          period_end?: string | null
          period_start?: string | null
          review_notes?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_invoices_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "wf_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_pay_rates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_date: string
          hourly_rate: number
          id: string
          note: string
          org_id: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_date: string
          hourly_rate: number
          id?: string
          note?: string
          org_id?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          hourly_rate?: number
          id?: string
          note?: string
          org_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_pay_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_pay_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_pay_rates_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_permissions: {
        Row: {
          can_admin: boolean
          can_documents: boolean
          can_expenses: boolean
          can_finance: boolean
          can_manage: boolean
          can_pay: boolean
          can_personnel: boolean
          can_purge: boolean
          org_id: string
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_admin?: boolean
          can_documents?: boolean
          can_expenses?: boolean
          can_finance?: boolean
          can_manage?: boolean
          can_pay?: boolean
          can_personnel?: boolean
          can_purge?: boolean
          org_id: string
          profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_admin?: boolean
          can_documents?: boolean
          can_expenses?: boolean
          can_finance?: boolean
          can_manage?: boolean
          can_pay?: boolean
          can_personnel?: boolean
          can_purge?: boolean
          org_id?: string
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wf_permissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_permissions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_permissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_personnel_records: {
        Row: {
          action_taken: string
          agency_contact_notified: string
          agency_followup_status: string
          agency_notified_at: string | null
          agency_notify_method: string
          agency_response: string
          allegation: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          event_at: string | null
          findings: string
          followup_due: string | null
          followup_owner: string | null
          id: string
          observations: string
          org_id: string
          outcome: string
          property_id: string | null
          record_type: string
          reopen_reason: string
          replacement_requested: boolean
          replacement_worker_id: string | null
          reporting_person: string
          revision: number
          shift_id: string | null
          status: string
          title: string
          updated_at: string
          worker_id: string
          worker_response: string
        }
        Insert: {
          action_taken?: string
          agency_contact_notified?: string
          agency_followup_status?: string
          agency_notified_at?: string | null
          agency_notify_method?: string
          agency_response?: string
          allegation?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          event_at?: string | null
          findings?: string
          followup_due?: string | null
          followup_owner?: string | null
          id?: string
          observations?: string
          org_id?: string
          outcome?: string
          property_id?: string | null
          record_type: string
          reopen_reason?: string
          replacement_requested?: boolean
          replacement_worker_id?: string | null
          reporting_person?: string
          revision?: number
          shift_id?: string | null
          status?: string
          title: string
          updated_at?: string
          worker_id: string
          worker_response?: string
        }
        Update: {
          action_taken?: string
          agency_contact_notified?: string
          agency_followup_status?: string
          agency_notified_at?: string | null
          agency_notify_method?: string
          agency_response?: string
          allegation?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          event_at?: string | null
          findings?: string
          followup_due?: string | null
          followup_owner?: string | null
          id?: string
          observations?: string
          org_id?: string
          outcome?: string
          property_id?: string | null
          record_type?: string
          reopen_reason?: string
          replacement_requested?: boolean
          replacement_worker_id?: string | null
          reporting_person?: string
          revision?: number
          shift_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          worker_id?: string
          worker_response?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_personnel_records_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_followup_owner_fkey"
            columns: ["followup_owner"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_replacement_worker_id_fkey"
            columns: ["replacement_worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_records_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_personnel_revisions: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_name: string
          changed_fields: string[]
          id: string
          note: string
          org_id: string
          record_id: string
          revision: number
          snapshot: Json
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string
          changed_fields?: string[]
          id?: string
          note?: string
          org_id: string
          record_id: string
          revision: number
          snapshot: Json
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string
          changed_fields?: string[]
          id?: string
          note?: string
          org_id?: string
          record_id?: string
          revision?: number
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "wf_personnel_revisions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_personnel_revisions_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "wf_personnel_records"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_placement_hours: {
        Row: {
          approved_at: string
          approved_by: string | null
          holiday_hours: number
          id: string
          note: string
          org_id: string
          overtime_hours: number
          placement_id: string
          regular_hours: number
          shift_id: string | null
          source: string
          work_date: string
        }
        Insert: {
          approved_at?: string
          approved_by?: string | null
          holiday_hours?: number
          id?: string
          note?: string
          org_id?: string
          overtime_hours?: number
          placement_id: string
          regular_hours?: number
          shift_id?: string | null
          source?: string
          work_date: string
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          holiday_hours?: number
          id?: string
          note?: string
          org_id?: string
          overtime_hours?: number
          placement_id?: string
          regular_hours?: number
          shift_id?: string | null
          source?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_placement_hours_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placement_hours_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placement_hours_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placement_hours_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_placement_rates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_date: string
          holiday_rate: number | null
          id: string
          note: string
          org_id: string
          other_fees: number | null
          other_fees_note: string
          overtime_rate: number | null
          placement_id: string
          regular_rate: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_date: string
          holiday_rate?: number | null
          id?: string
          note?: string
          org_id?: string
          other_fees?: number | null
          other_fees_note?: string
          overtime_rate?: number | null
          placement_id: string
          regular_rate: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          holiday_rate?: number | null
          id?: string
          note?: string
          org_id?: string
          other_fees?: number | null
          other_fees_note?: string
          overtime_rate?: number | null
          placement_id?: string
          regular_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "wf_placement_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placement_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placement_rates_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "wf_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_placements: {
        Row: {
          access_review_note: string
          access_reviewed_at: string | null
          agency_id: string
          agency_ref: string
          confirmation_document_id: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          end_reason: string
          holiday_terms: string
          id: string
          last_shift_date: string | null
          notes: string
          org_id: string
          ot_terms: string
          property_id: string | null
          property_name: string
          replacement_notes: string
          replacement_worker_id: string | null
          start_date: string
          status: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          access_review_note?: string
          access_reviewed_at?: string | null
          agency_id: string
          agency_ref?: string
          confirmation_document_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          end_reason?: string
          holiday_terms?: string
          id?: string
          last_shift_date?: string | null
          notes?: string
          org_id?: string
          ot_terms?: string
          property_id?: string | null
          property_name?: string
          replacement_notes?: string
          replacement_worker_id?: string | null
          start_date: string
          status?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          access_review_note?: string
          access_reviewed_at?: string | null
          agency_id?: string
          agency_ref?: string
          confirmation_document_id?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          end_reason?: string
          holiday_terms?: string
          id?: string
          last_shift_date?: string | null
          notes?: string
          org_id?: string
          ot_terms?: string
          property_id?: string | null
          property_name?: string
          replacement_notes?: string
          replacement_worker_id?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_placements_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "wf_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placements_confirmation_fk"
            columns: ["confirmation_document_id"]
            isOneToOne: false
            referencedRelation: "wf_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placements_replacement_worker_id_fkey"
            columns: ["replacement_worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_placements_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_reminders: {
        Row: {
          assigned_to: string | null
          auto_resolved: boolean
          created_at: string
          dedupe_key: string
          due_date: string | null
          entity_id: string | null
          entity_type: string
          id: string
          kind: string
          org_id: string
          required_perm: string
          resolution_note: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          title: string
          worker_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          auto_resolved?: boolean
          created_at?: string
          dedupe_key: string
          due_date?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          kind: string
          org_id: string
          required_perm?: string
          resolution_note?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title: string
          worker_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          auto_resolved?: boolean
          created_at?: string
          dedupe_key?: string
          due_date?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          kind?: string
          org_id?: string
          required_perm?: string
          resolution_note?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wf_reminders_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_reminders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_reminders_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_reminders_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_requirement_templates: {
        Row: {
          active: boolean
          applies_to: string
          created_at: string
          doc_category: string | null
          id: string
          org_id: string
          required: boolean
          sort: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to: string
          created_at?: string
          doc_category?: string | null
          id?: string
          org_id?: string
          required?: boolean
          sort?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to?: string
          created_at?: string
          doc_category?: string | null
          id?: string
          org_id?: string
          required?: boolean
          sort?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_requirement_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_restriction_reviews: {
        Row: {
          decision: string
          id: string
          note: string
          org_id: string
          restriction_id: string
          reviewed_at: string
          reviewed_by: string | null
        }
        Insert: {
          decision: string
          id?: string
          note?: string
          org_id?: string
          restriction_id: string
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Update: {
          decision?: string
          id?: string
          note?: string
          org_id?: string
          restriction_id?: string
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wf_restriction_reviews_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_restriction_reviews_restriction_id_fkey"
            columns: ["restriction_id"]
            isOneToOne: false
            referencedRelation: "wf_restrictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_restriction_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_restrictions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lifted_at: string | null
          lifted_by: string | null
          org_id: string
          reason: string
          status: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          org_id?: string
          reason: string
          status?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lifted_at?: string | null
          lifted_by?: string | null
          org_id?: string
          reason?: string
          status?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_restrictions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_restrictions_lifted_by_fkey"
            columns: ["lifted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_restrictions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_restrictions_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "wf_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_settings: {
        Row: {
          doc_expiry_days: number[]
          followup_due_days: number
          invoice_due_days: number
          next_worker_number: number
          org_id: string
          placement_end_days: number
          retention_note: string
          retention_review_years: number | null
          updated_at: string
          updated_by: string | null
          worker_code_prefix: string
        }
        Insert: {
          doc_expiry_days?: number[]
          followup_due_days?: number
          invoice_due_days?: number
          next_worker_number?: number
          org_id?: string
          placement_end_days?: number
          retention_note?: string
          retention_review_years?: number | null
          updated_at?: string
          updated_by?: string | null
          worker_code_prefix?: string
        }
        Update: {
          doc_expiry_days?: number[]
          followup_due_days?: number
          invoice_due_days?: number
          next_worker_number?: number
          org_id?: string
          placement_end_days?: number
          retention_note?: string
          retention_review_years?: number | null
          updated_at?: string
          updated_by?: string | null
          worker_code_prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wf_workers: {
        Row: {
          address: string
          agency_id: string | null
          agency_worker_ref: string
          archived_at: string | null
          archived_by: string | null
          availability: string
          created_at: string
          created_by: string | null
          email: string
          emergency_name: string
          emergency_phone: string
          emergency_relationship: string
          first_name: string
          id: string
          last_name: string
          org_id: string
          phone: string
          photo_path: string | null
          position: string
          preferred_contact: string
          profile_id: string | null
          service_areas: string[]
          source: string
          staff_id: string | null
          start_date: string | null
          status: string
          updated_at: string
          worker_code: string
        }
        Insert: {
          address?: string
          agency_id?: string | null
          agency_worker_ref?: string
          archived_at?: string | null
          archived_by?: string | null
          availability?: string
          created_at?: string
          created_by?: string | null
          email?: string
          emergency_name?: string
          emergency_phone?: string
          emergency_relationship?: string
          first_name: string
          id?: string
          last_name: string
          org_id?: string
          phone?: string
          photo_path?: string | null
          position?: string
          preferred_contact?: string
          profile_id?: string | null
          service_areas?: string[]
          source: string
          staff_id?: string | null
          start_date?: string | null
          status: string
          updated_at?: string
          worker_code?: string
        }
        Update: {
          address?: string
          agency_id?: string | null
          agency_worker_ref?: string
          archived_at?: string | null
          archived_by?: string | null
          availability?: string
          created_at?: string
          created_by?: string | null
          email?: string
          emergency_name?: string
          emergency_phone?: string
          emergency_relationship?: string
          first_name?: string
          id?: string
          last_name?: string
          org_id?: string
          phone?: string
          photo_path?: string | null
          position?: string
          preferred_contact?: string
          profile_id?: string | null
          service_areas?: string[]
          source?: string
          staff_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          worker_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "wf_workers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "wf_agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_workers_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_workers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_workers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_workers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wf_workers_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ex__date: {
        Args: { allow_null?: boolean; label: string; v: string }
        Returns: string
      }
      ex__diff: { Args: { a: Json; b: Json }; Returns: Record<string, unknown> }
      ex__log: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_exp: string
          p_fields?: string[]
          p_pay: string
          p_reimb: string
          p_summary: string
        }
        Returns: undefined
      }
      ex__money: {
        Args: { allow_null?: boolean; label: string; v: string }
        Returns: number
      }
      ex__next: { Args: { o: string; p_kind: string }; Returns: string }
      ex__paid: { Args: { r: string }; Returns: number }
      ex__recompute: { Args: { r: string }; Returns: undefined }
      ex__require: { Args: never; Returns: string }
      ex__uuid: { Args: { v: string }; Returns: string }
      ex_access: { Args: never; Returns: boolean }
      ex_archive_attachment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      ex_archive_expenditure: {
        Args: { p_archive: boolean; p_id: string; p_reason: string }
        Returns: undefined
      }
      ex_confirm_duplicate: {
        Args: { p_id: string; p_note: string }
        Returns: undefined
      }
      ex_log_event: {
        Args: { p_action: string; p_exp: string; p_summary: string }
        Returns: undefined
      }
      ex_lookups: { Args: never; Returns: Json }
      ex_possible_duplicates: {
        Args: {
          p_amount: number
          p_date: string
          p_exclude: string
          p_ref: string
          p_vendor: string
        }
        Returns: {
          amount: number
          code: string
          id: string
          invoice_ref: string
          spent_on: string
          vendor: string
        }[]
      }
      ex_record_payment: { Args: { p: Json }; Returns: Json }
      ex_register_attachment: {
        Args: {
          p_exp: string
          p_mime: string
          p_name: string
          p_path: string
          p_pay: string
          p_size: number
        }
        Returns: string
      }
      ex_reverse_payment: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      ex_review_reimbursement: {
        Args: {
          p_action: string
          p_amount: string
          p_id: string
          p_note: string
        }
        Returns: undefined
      }
      ex_save_category: {
        Args: {
          p_active: boolean
          p_id: string
          p_kind: string
          p_name: string
          p_sort: number
        }
        Returns: string
      }
      ex_save_expenditure: { Args: { p: Json; p_id: string }; Returns: Json }
      ex_save_reimbursement: { Args: { p: Json; p_id: string }; Returns: Json }
      fw_distance_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_org_admin: { Args: never; Returns: boolean }
      my_org_id: { Args: never; Returns: string }
      tc__admin: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          email: string
          field_guide_acknowledged_at: string | null
          full_name: string
          id: string
          org_id: string
          role: string
          terms_accepted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tc__check_property: {
        Args: { p_org: string; p_property: string }
        Returns: undefined
      }
      tc__log: {
        Args: {
          p_action: string
          p_actor: Database["public"]["Tables"]["profiles"]["Row"]
          p_detail: Json
          p_entry: string
          p_org: string
        }
        Returns: undefined
      }
      tc__me: {
        Args: never
        Returns: {
          active: boolean
          created_at: string
          email: string
          field_guide_acknowledged_at: string | null
          full_name: string
          id: string
          org_id: string
          role: string
          terms_accepted_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tc__snap: {
        Args: { e: Database["public"]["Tables"]["time_entries"]["Row"] }
        Returns: Json
      }
      tc_admin_save: {
        Args: {
          p_clock_in: string
          p_clock_out: string
          p_id: string
          p_profile_id: string
          p_property_id?: string
          p_reason?: string
        }
        Returns: {
          admin_note: string
          approved_at: string | null
          approved_by: string | null
          clock_in: string
          clock_out: string | null
          created_at: string
          edited: boolean
          employee_note: string
          id: string
          org_id: string
          profile_id: string | null
          property_id: string | null
          source: string
          status: string
          updated_at: string
          worker_name: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tc_clock_in: {
        Args: { p_note?: string; p_property_id?: string }
        Returns: {
          admin_note: string
          approved_at: string | null
          approved_by: string | null
          clock_in: string
          clock_out: string | null
          created_at: string
          edited: boolean
          employee_note: string
          id: string
          org_id: string
          profile_id: string | null
          property_id: string | null
          source: string
          status: string
          updated_at: string
          worker_name: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tc_clock_out: {
        Args: { p_note?: string }
        Returns: {
          admin_note: string
          approved_at: string | null
          approved_by: string | null
          clock_in: string
          clock_out: string | null
          created_at: string
          edited: boolean
          employee_note: string
          id: string
          org_id: string
          profile_id: string | null
          property_id: string | null
          source: string
          status: string
          updated_at: string
          worker_name: string
        }
        SetofOptions: {
          from: "*"
          to: "time_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      tc_pay_rates: {
        Args: never
        Returns: {
          effective_date: string
          hourly_rate: number
          profile_id: string
        }[]
      }
      tc_review: {
        Args: { p_action: string; p_ids: string[]; p_note?: string }
        Returns: number
      }
      verify_cron_secret: { Args: { p_secret: string }; Returns: boolean }
      wf__log: {
        Args: {
          p_action: string
          p_dedupe?: boolean
          p_entity: string
          p_entity_id: string
          p_perm: string
          p_summary: string
          p_worker: string
        }
        Returns: undefined
      }
      wf__personnel_clean: {
        Args: { is_agency: boolean; p: Json }
        Returns: Json
      }
      wf__reminder_candidates: {
        Args: { o: string }
        Returns: {
          dedupe_key: string
          due_date: string
          entity_id: string
          entity_type: string
          kind: string
          required_perm: string
          title: string
          worker_id: string
        }[]
      }
      wf__split_name: { Args: { n: string }; Returns: Record<string, unknown> }
      wf__sync_profile: {
        Args: { p_backfill?: boolean; p_id: string }
        Returns: string
      }
      wf_apply_checklist: {
        Args: { p_kind: string; p_placement?: string; p_worker: string }
        Returns: number
      }
      wf_apply_template_changes: { Args: { p_kind: string }; Returns: Json }
      wf_doc_visible: { Args: { c: string; owner: string }; Returns: boolean }
      wf_ensure_setup: { Args: never; Returns: Json }
      wf_followups: {
        Args: never
        Returns: {
          followup_due: string
          followup_owner: string
          id: string
          record_type: string
          status: string
          worker_id: string
        }[]
      }
      wf_has: { Args: { p: string }; Returns: boolean }
      wf_link_team_member: { Args: { p_profile: string }; Returns: string }
      wf_log_event: {
        Args: {
          p_action: string
          p_entity: string
          p_entity_id: string
          p_perm?: string
          p_summary: string
          p_worker: string
        }
        Returns: undefined
      }
      wf_my_permissions: { Args: never; Returns: Json }
      wf_pay_add: {
        Args: {
          p_effective: string
          p_note: string
          p_rate: number
          p_worker: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          effective_date: string
          hourly_rate: number
          id: string
          note: string
          org_id: string
          worker_id: string
        }
        SetofOptions: {
          from: "*"
          to: "wf_pay_rates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wf_pay_list: {
        Args: { p_worker: string }
        Returns: {
          created_at: string
          created_by: string | null
          effective_date: string
          hourly_rate: number
          id: string
          note: string
          org_id: string
          worker_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "wf_pay_rates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      wf_permission_roster: { Args: never; Returns: Json }
      wf_personnel_history: {
        Args: { p_id: string }
        Returns: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_name: string
          changed_fields: string[]
          id: string
          note: string
          org_id: string
          record_id: string
          revision: number
          snapshot: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "wf_personnel_revisions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      wf_personnel_list: {
        Args: { p_worker: string }
        Returns: {
          action_taken: string
          agency_contact_notified: string
          agency_followup_status: string
          agency_notified_at: string | null
          agency_notify_method: string
          agency_response: string
          allegation: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          event_at: string | null
          findings: string
          followup_due: string | null
          followup_owner: string | null
          id: string
          observations: string
          org_id: string
          outcome: string
          property_id: string | null
          record_type: string
          reopen_reason: string
          replacement_requested: boolean
          replacement_worker_id: string | null
          reporting_person: string
          revision: number
          shift_id: string | null
          status: string
          title: string
          updated_at: string
          worker_id: string
          worker_response: string
        }[]
        SetofOptions: {
          from: "*"
          to: "wf_personnel_records"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      wf_personnel_reopen: {
        Args: { p_id: string; p_reason: string }
        Returns: {
          action_taken: string
          agency_contact_notified: string
          agency_followup_status: string
          agency_notified_at: string | null
          agency_notify_method: string
          agency_response: string
          allegation: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          event_at: string | null
          findings: string
          followup_due: string | null
          followup_owner: string | null
          id: string
          observations: string
          org_id: string
          outcome: string
          property_id: string | null
          record_type: string
          reopen_reason: string
          replacement_requested: boolean
          replacement_worker_id: string | null
          reporting_person: string
          revision: number
          shift_id: string | null
          status: string
          title: string
          updated_at: string
          worker_id: string
          worker_response: string
        }
        SetofOptions: {
          from: "*"
          to: "wf_personnel_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wf_personnel_save: {
        Args: { p: Json; p_id: string }
        Returns: {
          action_taken: string
          agency_contact_notified: string
          agency_followup_status: string
          agency_notified_at: string | null
          agency_notify_method: string
          agency_response: string
          allegation: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          event_at: string | null
          findings: string
          followup_due: string | null
          followup_owner: string | null
          id: string
          observations: string
          org_id: string
          outcome: string
          property_id: string | null
          record_type: string
          reopen_reason: string
          replacement_requested: boolean
          replacement_worker_id: string | null
          reporting_person: string
          revision: number
          shift_id: string | null
          status: string
          title: string
          updated_at: string
          worker_id: string
          worker_response: string
        }
        SetofOptions: {
          from: "*"
          to: "wf_personnel_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      wf_possible_duplicates: {
        Args: {
          p_email: string
          p_exclude?: string
          p_first: string
          p_last: string
          p_phone: string
        }
        Returns: {
          full_name: string
          id: string
          reason: string
          source: string
          worker_code: string
        }[]
      }
      wf_purge_document: {
        Args: { p_confirm: boolean; p_document: string }
        Returns: string[]
      }
      wf_purge_worker: {
        Args: { p_confirm: string; p_worker: string }
        Returns: string[]
      }
      wf_refresh_reminders: { Args: never; Returns: number }
      wf_register_upload: {
        Args: {
          p_category: string
          p_class: string
          p_document: string
          p_exp: string
          p_file_name: string
          p_issue: string
          p_mime: string
          p_owner_id: string
          p_owner_type: string
          p_path: string
          p_signed: boolean
          p_size: number
          p_title: string
        }
        Returns: Json
      }
      wf_reminder_action: {
        Args: {
          p_action: string
          p_assignee?: string
          p_id: string
          p_note?: string
        }
        Returns: undefined
      }
      wf_require: { Args: { p: string }; Returns: undefined }
      wf_restriction_add: {
        Args: { p_reason: string; p_worker: string }
        Returns: string
      }
      wf_restriction_review: {
        Args: {
          p_decision: string
          p_id: string
          p_new_status?: string
          p_note: string
        }
        Returns: undefined
      }
      wf_restrictions_list: { Args: { p_worker: string }; Returns: Json }
      wf_review_document: {
        Args: { p_notes: string; p_status: string; p_version: string }
        Returns: undefined
      }
      wf_set_permissions: {
        Args: { p: Json; p_profile: string }
        Returns: undefined
      }
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
