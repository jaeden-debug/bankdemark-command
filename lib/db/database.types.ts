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
      accounts: {
        Row: {
          account_kind: Database["public"]["Enums"]["account_kind"]
          balance_as_of: string | null
          business_id: string
          created_at: string
          currency: string
          external_id: string | null
          id: string
          institution: string | null
          is_active: boolean
          last_sync_attempt_at: string | null
          last_synced_at: string | null
          mask: string | null
          name: string
          opening_balance_minor: number
          provider: string | null
          reported_balance_minor: number | null
          source: Database["public"]["Enums"]["data_source"]
          sync_error: string | null
          sync_status: string
          updated_at: string
        }
        Insert: {
          account_kind?: Database["public"]["Enums"]["account_kind"]
          balance_as_of?: string | null
          business_id: string
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          institution?: string | null
          is_active?: boolean
          last_sync_attempt_at?: string | null
          last_synced_at?: string | null
          mask?: string | null
          name: string
          opening_balance_minor?: number
          provider?: string | null
          reported_balance_minor?: number | null
          source?: Database["public"]["Enums"]["data_source"]
          sync_error?: string | null
          sync_status?: string
          updated_at?: string
        }
        Update: {
          account_kind?: Database["public"]["Enums"]["account_kind"]
          balance_as_of?: string | null
          business_id?: string
          created_at?: string
          currency?: string
          external_id?: string | null
          id?: string
          institution?: string | null
          is_active?: boolean
          last_sync_attempt_at?: string | null
          last_synced_at?: string | null
          mask?: string | null
          name?: string
          opening_balance_minor?: number
          provider?: string | null
          reported_balance_minor?: number | null
          source?: Database["public"]["Enums"]["data_source"]
          sync_error?: string | null
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversations: {
        Row: {
          business_id: string | null
          created_at: string
          id: string
          last_context_summary: string | null
          summary: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          id?: string
          last_context_summary?: string | null
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          id?: string
          last_context_summary?: string | null
          summary?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_conversations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ai_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          count: number
          created_at: string
          id: string
          message_count: number
          updated_at: string
          usage_date: string
          used_date: string
          user_id: string
        }
        Insert: {
          count?: number
          created_at?: string
          id?: string
          message_count?: number
          updated_at?: string
          usage_date?: string
          used_date?: string
          user_id: string
        }
        Update: {
          count?: number
          created_at?: string
          id?: string
          message_count?: number
          updated_at?: string
          usage_date?: string
          used_date?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          business_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          request_id: string | null
          source: Database["public"]["Enums"]["data_source"]
        }
        Insert: {
          action: string
          actor_type?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          business_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: number
          request_id?: string | null
          source?: Database["public"]["Enums"]["data_source"]
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          business_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: number
          request_id?: string | null
          source?: Database["public"]["Enums"]["data_source"]
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_date: string
          brand_id: string | null
          business_id: string
          client_id: string | null
          commission_expected_minor: number
          commission_rate: number | null
          commission_received_minor: number
          commission_status: Database["public"]["Enums"]["commission_state"]
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          gross_value_minor: number
          id: string
          notes: string | null
          project_id: string | null
          recognition_mode: string
          reference: string | null
          service_date: string | null
          service_fee_minor: number
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          booking_date?: string
          brand_id?: string | null
          business_id: string
          client_id?: string | null
          commission_expected_minor?: number
          commission_rate?: number | null
          commission_received_minor?: number
          commission_status?: Database["public"]["Enums"]["commission_state"]
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          gross_value_minor?: number
          id?: string
          notes?: string | null
          project_id?: string | null
          recognition_mode?: string
          reference?: string | null
          service_date?: string | null
          service_fee_minor?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          booking_date?: string
          brand_id?: string | null
          business_id?: string
          client_id?: string | null
          commission_expected_minor?: number
          commission_rate?: number | null
          commission_received_minor?: number
          commission_status?: Database["public"]["Enums"]["commission_state"]
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          gross_value_minor?: number
          id?: string
          notes?: string | null
          project_id?: string | null
          recognition_mode?: string
          reference?: string | null
          service_date?: string | null
          service_fee_minor?: number
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          business_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          revenue_note: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          revenue_note?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          revenue_note?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          accepted_at: string
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["business_role"]
          user_id: string
        }
        Insert: {
          accepted_at?: string
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["business_role"]
          user_id: string
        }
        Update: {
          accepted_at?: string
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["business_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_monthly_summary: {
        Row: {
          business_id: string
          cash_in_minor: number
          cash_out_minor: number
          computed_at: string
          currency: string
          expenses_minor: number
          gross_volume_minor: number
          month: string
          profit_minor: number
          recognized_revenue_minor: number
          transaction_count: number
        }
        Insert: {
          business_id: string
          cash_in_minor?: number
          cash_out_minor?: number
          computed_at?: string
          currency: string
          expenses_minor?: number
          gross_volume_minor?: number
          month: string
          profit_minor?: number
          recognized_revenue_minor?: number
          transaction_count?: number
        }
        Update: {
          business_id?: string
          cash_in_minor?: number
          cash_out_minor?: number
          computed_at?: string
          currency?: string
          expenses_minor?: number
          gross_volume_minor?: number
          month?: string
          profit_minor?: number
          recognized_revenue_minor?: number
          transaction_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_monthly_summary_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          accounting_basis: string
          base_currency: string
          brand_model: string
          business_type: string
          country: string
          created_at: string
          earns_commissions: boolean
          fiscal_year_start_month: number
          handles_client_funds: boolean
          id: string
          is_personal: boolean
          name: string
          owner_id: string
          parent_business_id: string | null
          region: string | null
          revenue_model: string[]
          status: string
          tax_jurisdiction: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          accounting_basis?: string
          base_currency?: string
          brand_model?: string
          business_type?: string
          country?: string
          created_at?: string
          earns_commissions?: boolean
          fiscal_year_start_month?: number
          handles_client_funds?: boolean
          id?: string
          is_personal?: boolean
          name: string
          owner_id: string
          parent_business_id?: string | null
          region?: string | null
          revenue_model?: string[]
          status?: string
          tax_jurisdiction?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          accounting_basis?: string
          base_currency?: string
          brand_model?: string
          business_type?: string
          country?: string
          created_at?: string
          earns_commissions?: boolean
          fiscal_year_start_month?: number
          handles_client_funds?: boolean
          id?: string
          is_personal?: boolean
          name?: string
          owner_id?: string
          parent_business_id?: string | null
          region?: string | null
          revenue_model?: string[]
          status?: string
          tax_jurisdiction?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "businesses_parent_business_id_fkey"
            columns: ["parent_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      calculator_shares: {
        Row: {
          calculator: string
          created_at: string
          id: string
          inputs: Json
          results: Json
        }
        Insert: {
          calculator: string
          created_at?: string
          id: string
          inputs?: Json
          results?: Json
        }
        Update: {
          calculator?: string
          created_at?: string
          id?: string
          inputs?: Json
          results?: Json
        }
        Relationships: []
      }
      categories: {
        Row: {
          business_id: string | null
          business_types: string[]
          created_at: string
          id: string
          is_active: boolean
          is_system: boolean
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          tax_treatment: string | null
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          business_types?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          kind: Database["public"]["Enums"]["category_kind"]
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          tax_treatment?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          business_types?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          kind?: Database["public"]["Enums"]["category_kind"]
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          tax_treatment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_payments: {
        Row: {
          amount_minor: number
          booking_id: string
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          received_on: string
          transaction_id: string | null
        }
        Insert: {
          amount_minor: number
          booking_id: string
          business_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          received_on?: string
          transaction_id?: string | null
        }
        Update: {
          amount_minor?: number
          booking_id?: string
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          received_on?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_payments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      counterparties: {
        Row: {
          business_id: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterparties_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          balance: number
          created_at: string
          debt_type: string | null
          id: string
          interest_rate: number
          minimum_payment: number
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          debt_type?: string | null
          id?: string
          interest_rate?: number
          minimum_payment?: number
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          debt_type?: string | null
          id?: string
          interest_rate?: number
          minimum_payment?: number
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          amount_minor: number | null
          business_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          currency: string | null
          doc_date: string | null
          doc_type: string
          extracted: Json | null
          extracted_at: string | null
          extraction_confidence: number | null
          extraction_error: string | null
          extraction_method: string | null
          extraction_model: string | null
          id: string
          matched_transaction_id: string | null
          mime_type: string | null
          original_filename: string | null
          page_count: number | null
          sha256: string | null
          size_bytes: number | null
          status: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          vendor: string | null
        }
        Insert: {
          amount_minor?: number | null
          business_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          currency?: string | null
          doc_date?: string | null
          doc_type?: string
          extracted?: Json | null
          extracted_at?: string | null
          extraction_confidence?: number | null
          extraction_error?: string | null
          extraction_method?: string | null
          extraction_model?: string | null
          id?: string
          matched_transaction_id?: string | null
          mime_type?: string | null
          original_filename?: string | null
          page_count?: number | null
          sha256?: string | null
          size_bytes?: number | null
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          vendor?: string | null
        }
        Update: {
          amount_minor?: number | null
          business_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          currency?: string | null
          doc_date?: string | null
          doc_type?: string
          extracted?: Json | null
          extracted_at?: string | null
          extraction_confidence?: number | null
          extraction_error?: string | null
          extraction_method?: string | null
          extraction_model?: string | null
          id?: string
          matched_transaction_id?: string | null
          mime_type?: string | null
          original_filename?: string | null
          page_count?: number | null
          sha256?: string | null
          size_bytes?: number | null
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      email_leads: {
        Row: {
          created_at: string
          email: string
          id: string
          source: string | null
          user_type: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          source?: string | null
          user_type?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          source?: string | null
          user_type?: string | null
        }
        Relationships: []
      }
      financial_snapshots: {
        Row: {
          average_debt_interest: number | null
          business_expenses: number | null
          business_revenue: number | null
          created_at: string
          credit_score_range: string | null
          desired_retirement_age: number | null
          emergency_fund_target_months: number | null
          fixed_expenses: number | null
          housing_payment: number | null
          id: string
          investment_balance: number | null
          minimum_debt_payment: number | null
          monthly_income: number | null
          passive_income_target: number | null
          primary_goal: string | null
          risk_tolerance: string | null
          savings_balance: number | null
          secondary_goal: string | null
          total_debt: number | null
          updated_at: string
          user_id: string
          variable_expenses: number | null
        }
        Insert: {
          average_debt_interest?: number | null
          business_expenses?: number | null
          business_revenue?: number | null
          created_at?: string
          credit_score_range?: string | null
          desired_retirement_age?: number | null
          emergency_fund_target_months?: number | null
          fixed_expenses?: number | null
          housing_payment?: number | null
          id?: string
          investment_balance?: number | null
          minimum_debt_payment?: number | null
          monthly_income?: number | null
          passive_income_target?: number | null
          primary_goal?: string | null
          risk_tolerance?: string | null
          savings_balance?: number | null
          secondary_goal?: string | null
          total_debt?: number | null
          updated_at?: string
          user_id: string
          variable_expenses?: number | null
        }
        Update: {
          average_debt_interest?: number | null
          business_expenses?: number | null
          business_revenue?: number | null
          created_at?: string
          credit_score_range?: string | null
          desired_retirement_age?: number | null
          emergency_fund_target_months?: number | null
          fixed_expenses?: number | null
          housing_payment?: number | null
          id?: string
          investment_balance?: number | null
          minimum_debt_payment?: number | null
          monthly_income?: number | null
          passive_income_target?: number | null
          primary_goal?: string | null
          risk_tolerance?: string | null
          savings_balance?: number | null
          secondary_goal?: string | null
          total_debt?: number | null
          updated_at?: string
          user_id?: string
          variable_expenses?: number | null
        }
        Relationships: []
      }
      founder_emails: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          completed: boolean
          created_at: string
          current: number | null
          current_amount: number | null
          goal_type: string | null
          id: string
          notes: string | null
          priority: number | null
          target: number | null
          target_amount: number | null
          target_date: string | null
          title: string
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          current?: number | null
          current_amount?: number | null
          goal_type?: string | null
          id?: string
          notes?: string | null
          priority?: number | null
          target?: number | null
          target_amount?: number | null
          target_date?: string | null
          title: string
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          current?: number | null
          current_amount?: number | null
          goal_type?: string | null
          id?: string
          notes?: string | null
          priority?: number | null
          target?: number | null
          target_amount?: number | null
          target_date?: string | null
          title?: string
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          account_id: string | null
          business_id: string
          committed_at: string | null
          created_at: string
          created_by: string | null
          duplicate_count: number
          error_count: number
          errors: Json
          filename: string | null
          id: string
          imported_count: number
          mapping: Json
          row_count: number
          source: Database["public"]["Enums"]["data_source"]
          status: string
        }
        Insert: {
          account_id?: string | null
          business_id: string
          committed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_count?: number
          error_count?: number
          errors?: Json
          filename?: string | null
          id?: string
          imported_count?: number
          mapping?: Json
          row_count?: number
          source?: Database["public"]["Enums"]["data_source"]
          status?: string
        }
        Update: {
          account_id?: string | null
          business_id?: string
          committed_at?: string | null
          created_at?: string
          created_by?: string | null
          duplicate_count?: number
          error_count?: number
          errors?: Json
          filename?: string | null
          id?: string
          imported_count?: number
          mapping?: Json
          row_count?: number
          source?: Database["public"]["Enums"]["data_source"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_custom_fields: {
        Row: {
          business_id: string
          created_at: string
          field_type: string
          help_text: string | null
          id: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          field_type?: string
          help_text?: string | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          field_type?: string
          help_text?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_custom_fields_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_deliveries: {
        Row: {
          bounce_type: string | null
          bounced_at: string | null
          business_id: string
          cc_email: string | null
          channel: string
          created_at: string
          delivered_at: string | null
          error: string | null
          failed_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          last_event_at: string | null
          opened_at: string | null
          provider: string | null
          provider_message_id: string | null
          reply_to: string | null
          sent_by: string | null
          state: Database["public"]["Enums"]["invoice_delivery_state"]
          subject: string | null
          to_email: string | null
          updated_at: string
        }
        Insert: {
          bounce_type?: string | null
          bounced_at?: string | null
          business_id: string
          cc_email?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          last_event_at?: string | null
          opened_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          reply_to?: string | null
          sent_by?: string | null
          state?: Database["public"]["Enums"]["invoice_delivery_state"]
          subject?: string | null
          to_email?: string | null
          updated_at?: string
        }
        Update: {
          bounce_type?: string | null
          bounced_at?: string | null
          business_id?: string
          cc_email?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          last_event_at?: string | null
          opened_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          reply_to?: string | null
          sent_by?: string | null
          state?: Database["public"]["Enums"]["invoice_delivery_state"]
          subject?: string | null
          to_email?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_deliveries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_deliveries_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          business_id: string
          created_at: string
          detail: Json
          event: string
          id: number
          invoice_id: string
        }
        Insert: {
          actor_type?: string
          actor_user_id?: string | null
          business_id: string
          created_at?: string
          detail?: Json
          event: string
          id?: number
          invoice_id: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string
          created_at?: string
          detail?: Json
          event?: string
          id?: number
          invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          business_id: string
          category_id: string | null
          created_at: string
          description: string
          discount_minor: number
          id: string
          invoice_id: string
          position: number
          project_id: string | null
          quantity: number
          subtotal_minor: number
          tax_code: string | null
          tax_label: string | null
          tax_minor: number
          tax_rate: number
          tax_treatment: Database["public"]["Enums"]["tax_treatment"]
          total_minor: number
          unit_price_minor: number
        }
        Insert: {
          business_id: string
          category_id?: string | null
          created_at?: string
          description: string
          discount_minor?: number
          id?: string
          invoice_id: string
          position?: number
          project_id?: string | null
          quantity?: number
          subtotal_minor?: number
          tax_code?: string | null
          tax_label?: string | null
          tax_minor?: number
          tax_rate?: number
          tax_treatment?: Database["public"]["Enums"]["tax_treatment"]
          total_minor?: number
          unit_price_minor?: number
        }
        Update: {
          business_id?: string
          category_id?: string | null
          created_at?: string
          description?: string
          discount_minor?: number
          id?: string
          invoice_id?: string
          position?: number
          project_id?: string | null
          quantity?: number
          subtotal_minor?: number
          tax_code?: string | null
          tax_label?: string | null
          tax_minor?: number
          tax_rate?: number
          tax_treatment?: Database["public"]["Enums"]["tax_treatment"]
          total_minor?: number
          unit_price_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount_minor: number
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string
          match_confidence: number | null
          match_status: string
          method: string | null
          notes: string | null
          received_on: string
          reference: string | null
          source: Database["public"]["Enums"]["data_source"]
          transaction_id: string | null
        }
        Insert: {
          amount_minor: number
          business_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id: string
          match_confidence?: number | null
          match_status?: string
          method?: string | null
          notes?: string | null
          received_on?: string
          reference?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          transaction_id?: string | null
        }
        Update: {
          amount_minor?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          match_confidence?: number | null
          match_status?: string
          method?: string | null
          notes?: string | null
          received_on?: string
          reference?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_settings: {
        Row: {
          accent_color: string
          address_line1: string | null
          address_line2: string | null
          business_id: string
          city: string | null
          country: string | null
          created_at: string
          default_due_days: number
          default_notes: string | null
          default_payment_terms: string
          default_tax_code: string | null
          default_terms: string | null
          email: string | null
          footer_text: string | null
          legal_name: string | null
          logo_path: string | null
          next_sequence: number
          number_include_year: boolean
          number_pad: number
          number_prefix: string
          payment_instructions: string | null
          phone: string | null
          postal_code: string | null
          region: string | null
          sequence_year: number | null
          show_bdm_credit: boolean
          tax_number: string | null
          tax_number_label: string
          template: string
          updated_at: string
          website: string | null
        }
        Insert: {
          accent_color?: string
          address_line1?: string | null
          address_line2?: string | null
          business_id: string
          city?: string | null
          country?: string | null
          created_at?: string
          default_due_days?: number
          default_notes?: string | null
          default_payment_terms?: string
          default_tax_code?: string | null
          default_terms?: string | null
          email?: string | null
          footer_text?: string | null
          legal_name?: string | null
          logo_path?: string | null
          next_sequence?: number
          number_include_year?: boolean
          number_pad?: number
          number_prefix?: string
          payment_instructions?: string | null
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          sequence_year?: number | null
          show_bdm_credit?: boolean
          tax_number?: string | null
          tax_number_label?: string
          template?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          accent_color?: string
          address_line1?: string | null
          address_line2?: string | null
          business_id?: string
          city?: string | null
          country?: string | null
          created_at?: string
          default_due_days?: number
          default_notes?: string | null
          default_payment_terms?: string
          default_tax_code?: string | null
          default_terms?: string | null
          email?: string | null
          footer_text?: string | null
          legal_name?: string | null
          logo_path?: string | null
          next_sequence?: number
          number_include_year?: boolean
          number_pad?: number
          number_prefix?: string
          payment_instructions?: string | null
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          sequence_year?: number | null
          show_bdm_credit?: boolean
          tax_number?: string | null
          tax_number_label?: string
          template?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance_minor: number
          booking_id: string | null
          business_id: string
          counterparty_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          custom_fields: Json
          discount_kind: string
          discount_minor: number
          discount_value: number
          document_id: string | null
          due_date: string
          id: string
          is_credit_note: boolean
          issue_date: string
          issued_at: string | null
          issued_business_snapshot: Json | null
          issued_client_snapshot: Json | null
          notes: string | null
          number: string | null
          paid_at: string | null
          paid_minor: number
          parent_invoice_id: string | null
          payment_instructions: string | null
          payment_terms: string | null
          project_id: string | null
          sent_at: string | null
          share_revoked_at: string | null
          share_token: string | null
          source: Database["public"]["Enums"]["data_source"]
          source_kind: Database["public"]["Enums"]["invoice_source_kind"]
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal_minor: number
          tax_breakdown: Json
          tax_minor: number
          terms: string | null
          total_minor: number
          updated_at: string
          viewed_at: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          balance_minor?: number
          booking_id?: string | null
          business_id: string
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          discount_kind?: string
          discount_minor?: number
          discount_value?: number
          document_id?: string | null
          due_date?: string
          id?: string
          is_credit_note?: boolean
          issue_date?: string
          issued_at?: string | null
          issued_business_snapshot?: Json | null
          issued_client_snapshot?: Json | null
          notes?: string | null
          number?: string | null
          paid_at?: string | null
          paid_minor?: number
          parent_invoice_id?: string | null
          payment_instructions?: string | null
          payment_terms?: string | null
          project_id?: string | null
          sent_at?: string | null
          share_revoked_at?: string | null
          share_token?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          source_kind?: Database["public"]["Enums"]["invoice_source_kind"]
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_minor?: number
          tax_breakdown?: Json
          tax_minor?: number
          terms?: string | null
          total_minor?: number
          updated_at?: string
          viewed_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          balance_minor?: number
          booking_id?: string | null
          business_id?: string
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          custom_fields?: Json
          discount_kind?: string
          discount_minor?: number
          discount_value?: number
          document_id?: string | null
          due_date?: string
          id?: string
          is_credit_note?: boolean
          issue_date?: string
          issued_at?: string | null
          issued_business_snapshot?: Json | null
          issued_client_snapshot?: Json | null
          notes?: string | null
          number?: string | null
          paid_at?: string | null
          paid_minor?: number
          parent_invoice_id?: string | null
          payment_instructions?: string | null
          payment_terms?: string | null
          project_id?: string | null
          sent_at?: string | null
          share_revoked_at?: string | null
          share_token?: string | null
          source?: Database["public"]["Enums"]["data_source"]
          source_kind?: Database["public"]["Enums"]["invoice_source_kind"]
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal_minor?: number
          tax_breakdown?: Json
          tax_minor?: number
          terms?: string | null
          total_minor?: number
          updated_at?: string
          viewed_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_parent_invoice_id_fkey"
            columns: ["parent_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age: number | null
          business_owner: boolean | null
          country: string | null
          created_at: string
          email: string | null
          first_name: string | null
          household_type: string | null
          id: string
          plan: string | null
          pro_plan: string | null
          region: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_type: string | null
        }
        Insert: {
          age?: number | null
          business_owner?: boolean | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          household_type?: string | null
          id: string
          plan?: string | null
          pro_plan?: string | null
          region?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_type?: string | null
        }
        Update: {
          age?: number | null
          business_owner?: boolean | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          household_type?: string | null
          id?: string
          plan?: string | null
          pro_plan?: string | null
          region?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_type?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          brand_id: string | null
          budget_minor: number | null
          business_id: string
          client_id: string | null
          code: string | null
          created_at: string
          ended_on: string | null
          id: string
          name: string
          notes: string | null
          started_on: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          budget_minor?: number | null
          business_id: string
          client_id?: string | null
          code?: string | null
          created_at?: string
          ended_on?: string | null
          id?: string
          name: string
          notes?: string | null
          started_on?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          budget_minor?: number | null
          business_id?: string
          client_id?: string | null
          code?: string | null
          created_at?: string
          ended_on?: string | null
          id?: string
          name?: string
          notes?: string | null
          started_on?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          id: number
          payload: Json | null
          processed_at: string
          provider: string
        }
        Insert: {
          event_id: string
          event_type: string
          id?: number
          payload?: Json | null
          processed_at?: string
          provider: string
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: number
          payload?: Json | null
          processed_at?: string
          provider?: string
        }
        Relationships: []
      }
      recommendation_events: {
        Row: {
          action: string
          created_at: string
          id: string
          recommendation_key: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          recommendation_key: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          recommendation_key?: string
          user_id?: string
        }
        Relationships: []
      }
      score_history: {
        Row: {
          band: string | null
          created_at: string
          health_label: string | null
          id: string
          recorded_at: string
          score: number
          source: string | null
          user_id: string
        }
        Insert: {
          band?: string | null
          created_at?: string
          health_label?: string | null
          id?: string
          recorded_at?: string
          score: number
          source?: string | null
          user_id: string
        }
        Update: {
          band?: string | null
          created_at?: string
          health_label?: string | null
          id?: string
          recorded_at?: string
          score?: number
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          plan: string
          price_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          plan?: string
          price_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tax_rates: {
        Row: {
          business_id: string | null
          code: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean
          jurisdiction: string
          label: string
          last_verified: string | null
          rate: number
          source: string | null
          source_url: string | null
          treatment: Database["public"]["Enums"]["tax_treatment"]
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          code: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          jurisdiction: string
          label: string
          last_verified?: string | null
          rate: number
          source?: string | null
          source_url?: string | null
          treatment?: Database["public"]["Enums"]["tax_treatment"]
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          code?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string
          label?: string
          last_verified?: string | null
          rate?: number
          source?: string | null
          source_url?: string | null
          treatment?: Database["public"]["Enums"]["tax_treatment"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          ai_confidence: number | null
          ai_suggested_category_id: string | null
          amount_minor: number
          booking_id: string | null
          brand_id: string | null
          business_id: string
          category_id: string | null
          confirmed_by_user: boolean
          counterparty_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          dedupe_hash: string | null
          deleted_at: string | null
          description: string
          document_id: string | null
          external_id: string | null
          extraction_confidence: number | null
          extraction_method: string | null
          gross_amount_minor: number | null
          id: string
          import_batch_id: string | null
          merchant: string | null
          notes: string | null
          occurred_on: string
          project_id: string | null
          raw: Json | null
          recognized_amount_minor: number | null
          review_status: Database["public"]["Enums"]["review_state"]
          source: Database["public"]["Enums"]["data_source"]
          source_document_id: string | null
          transaction_kind: Database["public"]["Enums"]["transaction_kind"]
          transfer_group_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          ai_suggested_category_id?: string | null
          amount_minor: number
          booking_id?: string | null
          brand_id?: string | null
          business_id: string
          category_id?: string | null
          confirmed_by_user?: boolean
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dedupe_hash?: string | null
          deleted_at?: string | null
          description?: string
          document_id?: string | null
          external_id?: string | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          gross_amount_minor?: number | null
          id?: string
          import_batch_id?: string | null
          merchant?: string | null
          notes?: string | null
          occurred_on: string
          project_id?: string | null
          raw?: Json | null
          recognized_amount_minor?: number | null
          review_status?: Database["public"]["Enums"]["review_state"]
          source?: Database["public"]["Enums"]["data_source"]
          source_document_id?: string | null
          transaction_kind?: Database["public"]["Enums"]["transaction_kind"]
          transfer_group_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          ai_suggested_category_id?: string | null
          amount_minor?: number
          booking_id?: string | null
          brand_id?: string | null
          business_id?: string
          category_id?: string | null
          confirmed_by_user?: boolean
          counterparty_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dedupe_hash?: string | null
          deleted_at?: string | null
          description?: string
          document_id?: string | null
          external_id?: string | null
          extraction_confidence?: number | null
          extraction_method?: string | null
          gross_amount_minor?: number | null
          id?: string
          import_batch_id?: string | null
          merchant?: string | null
          notes?: string | null
          occurred_on?: string
          project_id?: string | null
          raw?: Json | null
          recognized_amount_minor?: number | null
          review_status?: Database["public"]["Enums"]["review_state"]
          source?: Database["public"]["Enums"]["data_source"]
          source_document_id?: string | null
          transaction_kind?: Database["public"]["Enums"]["transaction_kind"]
          transfer_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_ai_suggested_category_id_fkey"
            columns: ["ai_suggested_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "counterparties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          business_id: string
          metric: string
          period: string
          updated_at: string
          used: number
        }
        Insert: {
          business_id: string
          metric: string
          period: string
          updated_at?: string
          used?: number
        }
        Update: {
          business_id?: string
          metric?: string
          period?: string
          updated_at?: string
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      zylx_approvals: {
        Row: {
          business_id: string
          created_at: string
          idempotency_key: string
          proposal_kind: string
          result: Json | null
          result_id: string | null
          result_kind: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          idempotency_key: string
          proposal_kind: string
          result?: Json | null
          result_id?: string | null
          result_kind: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          idempotency_key?: string
          proposal_kind?: string
          result?: Json | null
          result_id?: string | null
          result_kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zylx_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bdm_ar_position: {
        Args: { p_business_id: string }
        Returns: {
          currency: string
          invoice_count: number
          invoiced_minor: number
          overdue_count: number
          overdue_minor: number
          uninvoiced_commission_minor: number
        }[]
      }
      bdm_consume_usage: {
        Args: {
          p_amount?: number
          p_business_id: string
          p_limit: number
          p_metric: string
        }
        Returns: {
          allowed: boolean
          remaining: number
          used: number
        }[]
      }
      bdm_expense_types: {
        Args: never
        Returns: Database["public"]["Enums"]["transaction_kind"][]
      }
      bdm_next_invoice_number: {
        Args: { p_business_id: string }
        Returns: string
      }
      bdm_refresh_overdue_invoices: {
        Args: { p_business_id?: string }
        Returns: number
      }
      bdm_release_usage: {
        Args: { p_amount?: number; p_business_id: string; p_metric: string }
        Returns: undefined
      }
      bdm_revenue_types: {
        Args: never
        Returns: Database["public"]["Enums"]["transaction_kind"][]
      }
      bdm_role_rank: {
        Args: { r: Database["public"]["Enums"]["business_role"] }
        Returns: number
      }
      is_business_member: {
        Args: {
          p_business_id: string
          p_min_role?: Database["public"]["Enums"]["business_role"]
        }
        Returns: boolean
      }
    }
    Enums: {
      account_kind:
        | "bank"
        | "cash"
        | "credit_card"
        | "loan"
        | "investment"
        | "receivable"
        | "payable"
        | "other"
      business_role: "viewer" | "accountant" | "member" | "admin" | "owner"
      category_kind: "income" | "expense" | "asset" | "liability" | "equity"
      commission_state:
        | "expected"
        | "earned"
        | "receivable"
        | "partial"
        | "received"
        | "reversed"
        | "cancelled"
      data_source:
        | "manual"
        | "csv"
        | "zylx"
        | "mcp"
        | "stripe"
        | "shopify"
        | "paypal"
        | "square"
        | "bank_feed"
        | "system"
      invoice_delivery_state:
        | "queued"
        | "sent"
        | "delivered"
        | "bounced"
        | "failed"
      invoice_source_kind:
        | "manual"
        | "booking"
        | "commission"
        | "project"
        | "contract"
        | "recurring"
        | "order"
        | "other"
      invoice_status:
        | "draft"
        | "issued"
        | "sent"
        | "viewed"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "void"
      review_state:
        | "unreviewed"
        | "needs_review"
        | "auto_categorized"
        | "reviewed"
      tax_treatment: "standard" | "zero_rated" | "exempt" | "out_of_scope"
      transaction_kind:
        | "income"
        | "expense"
        | "transfer"
        | "owner_contribution"
        | "owner_draw"
        | "loan_proceeds"
        | "loan_payment"
        | "credit_card_payment"
        | "refund"
        | "reimbursement"
        | "commission"
        | "pass_through"
        | "asset_purchase"
        | "tax_payment"
        | "other"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      account_kind: [
        "bank",
        "cash",
        "credit_card",
        "loan",
        "investment",
        "receivable",
        "payable",
        "other",
      ],
      business_role: ["viewer", "accountant", "member", "admin", "owner"],
      category_kind: ["income", "expense", "asset", "liability", "equity"],
      commission_state: [
        "expected",
        "earned",
        "receivable",
        "partial",
        "received",
        "reversed",
        "cancelled",
      ],
      data_source: [
        "manual",
        "csv",
        "zylx",
        "mcp",
        "stripe",
        "shopify",
        "paypal",
        "square",
        "bank_feed",
        "system",
      ],
      invoice_delivery_state: [
        "queued",
        "sent",
        "delivered",
        "bounced",
        "failed",
      ],
      invoice_source_kind: [
        "manual",
        "booking",
        "commission",
        "project",
        "contract",
        "recurring",
        "order",
        "other",
      ],
      invoice_status: [
        "draft",
        "issued",
        "sent",
        "viewed",
        "partially_paid",
        "paid",
        "overdue",
        "void",
      ],
      review_state: [
        "unreviewed",
        "needs_review",
        "auto_categorized",
        "reviewed",
      ],
      tax_treatment: ["standard", "zero_rated", "exempt", "out_of_scope"],
      transaction_kind: [
        "income",
        "expense",
        "transfer",
        "owner_contribution",
        "owner_draw",
        "loan_proceeds",
        "loan_payment",
        "credit_card_payment",
        "refund",
        "reimbursement",
        "commission",
        "pass_through",
        "asset_purchase",
        "tax_payment",
        "other",
      ],
    },
  },
} as const
