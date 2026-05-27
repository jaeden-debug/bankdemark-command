// ============================================================
// BankDeMark Command — Core Types
// ============================================================

export type UserType =
  | 'individual'
  | 'student'
  | 'couple'
  | 'family'
  | 'freelancer'
  | 'small_business'
  | 'investor'
  | 'retiree';

export type HouseholdType = 'single' | 'couple' | 'family' | 'other';

export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export type CreditScoreRange =
  | 'poor'      // <580
  | 'fair'      // 580–669
  | 'good'      // 670–739
  | 'very_good' // 740–799
  | 'excellent'; // 800+

export type PrimaryGoal =
  | 'pay_off_debt'
  | 'build_emergency_fund'
  | 'save_for_home'
  | 'grow_investments'
  | 'retire_early'
  | 'start_business'
  | 'increase_income'
  | 'achieve_fire'
  | 'reduce_expenses';

export type DebtType =
  | 'credit_card'
  | 'student_loan'
  | 'auto_loan'
  | 'personal_loan'
  | 'mortgage'
  | 'heloc'
  | 'business_loan'
  | 'other';

export type ScoreBand = 'critical' | 'vulnerable' | 'stable' | 'strong' | 'elite';

// ============================================================
// Profile
// ============================================================

export interface UserProfile {
  id?: string;
  email?: string;
  first_name: string;
  age: number;
  country: string;
  region?: string;
  user_type: UserType;
  household_type: HouseholdType;
  business_owner: boolean;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Financial Snapshot (primary input data)
// ============================================================

export interface FinancialSnapshot {
  id?: string;
  user_id?: string;
  monthly_income: number;
  fixed_expenses: number;
  variable_expenses: number;
  housing_payment: number;
  total_debt: number;
  average_debt_interest: number;
  minimum_debt_payment: number;
  savings_balance: number;
  investment_balance: number;
  emergency_fund_target_months: number;
  credit_score_range: CreditScoreRange;
  primary_goal: PrimaryGoal;
  secondary_goal?: PrimaryGoal;
  desired_retirement_age: number;
  passive_income_target: number;
  risk_tolerance: RiskTolerance;
  business_revenue?: number;
  business_expenses?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Itemized Debt (optional, for debt engine)
// ============================================================

export interface Debt {
  id: string;
  user_id?: string;
  name: string;
  balance: number;
  interest_rate: number;
  minimum_payment: number;
  debt_type: DebtType;
}

// ============================================================
// Calculated Metrics
// ============================================================

export interface FinancialMetrics {
  // Cash flow
  monthly_cash_flow: number;
  annual_cash_flow: number;
  discretionary_income: number;

  // Rates
  savings_rate: number;           // 0–1
  debt_to_income_ratio: number;   // 0–1
  housing_ratio: number;          // 0–1

  // Status indicators
  emergency_runway_months: number;
  emergency_fund_target: number;
  emergency_fund_gap: number;
  emergency_status: 'critical' | 'low' | 'okay' | 'strong';

  // Net worth
  net_worth: number;
  total_assets: number;
  total_liabilities: number;

  // Debt metrics
  debt_pressure_score: number;    // 0–100 (higher = worse)
  debt_free_months: number;       // simplified model
  total_interest_cost: number;    // simplified model
  high_interest_debt_flag: boolean;

  // Wealth / retirement
  fire_number: number;
  retirement_gap: number;
  years_to_retirement: number;
  monthly_investment_needed: number;

  // Projections (10-year)
  projection_conservative: number;
  projection_moderate: number;
  projection_aggressive: number;

  // Passive income
  passive_income_capital_needed: number;
  monthly_passive_income_projected: number;

  // Health score
  health_score: number;           // 0–100
  health_band: ScoreBand;
  health_label: string;

  // Affordability
  max_safe_monthly_payment: number;

  // Flags
  cash_flow_negative: boolean;
  dangerously_high_debt: boolean;
  no_emergency_fund: boolean;
  near_retirement_underfunded: boolean;
}

// ============================================================
// Affordability Check
// ============================================================

export interface AffordabilityInput {
  purchase_amount: number;
  monthly_payment: number;
  down_payment: number;
  term_months: number;
  interest_rate: number;
  category: 'car' | 'rent' | 'home' | 'vacation' | 'baby' | 'business' | 'custom';
}

export interface AffordabilityResult {
  verdict: 'affordable' | 'risky' | 'not_recommended';
  verdict_label: string;
  verdict_color: string;
  score: number;
  cash_flow_impact: number;
  new_monthly_cash_flow: number;
  emergency_fund_months_remaining: number;
  new_debt_pressure: number;
  recommended_max_payment: number;
  reasons: string[];
  suggestions: string[];
}

// ============================================================
// Debt Payoff
// ============================================================

export interface DebtPayoffResult {
  method: 'avalanche' | 'snowball' | 'simplified';
  months_to_payoff: number;
  total_interest_paid: number;
  monthly_attack_payment: number;
  payoff_date: string;
  payoff_order?: { name: string; months: number; interest: number }[];
  interest_saved_vs_minimum: number;
}

// ============================================================
// Recommendation
// ============================================================

export interface Recommendation {
  key: string;
  category: 'cash_flow' | 'debt' | 'emergency' | 'investing' | 'insurance' | 'income' | 'tax' | 'business';
  priority: 'urgent' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action_label: string;
  action_href: string;
  icon: string;
}

// ============================================================
// Product (Marketplace / Affiliate)
// ============================================================

export interface MarketplaceProduct {
  id: string;
  category: string;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  cta_label: string;
  cta_href: string;    // Replace with real affiliate URL
  badge?: string;
  sponsored: boolean;
}

// ============================================================
// AI Coach
// ============================================================

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AIConversation {
  id: string;
  title: string;
  messages: AIMessage[];
  created_at: string;
}

// ============================================================
// Report
// ============================================================

export interface FinancialReport {
  type: 'monthly_wealth' | 'debt_freedom' | 'emergency_fund' | 'health_summary';
  generated_at: string;
  profile: UserProfile;
  snapshot: FinancialSnapshot;
  metrics: FinancialMetrics;
  recommendations: Recommendation[];
  score: number;
  score_band: ScoreBand;
  key_wins: string[];
  key_risks: string[];
  next_actions: string[];
}

// ============================================================
// Onboarding State
// ============================================================

export interface OnboardingData {
  // Step 1: Identity
  first_name: string;
  age: string;
  country: string;
  region: string;
  user_type: UserType | '';
  household_type: HouseholdType | '';

  // Step 2: Income & Expenses
  monthly_income: string;
  fixed_expenses: string;
  variable_expenses: string;
  housing_payment: string;
  business_owner: boolean;
  business_revenue: string;
  business_expenses: string;

  // Step 3: Debt & Credit
  total_debt: string;
  average_debt_interest: string;
  minimum_debt_payment: string;
  credit_score_range: CreditScoreRange | '';

  // Step 4: Savings & Investments
  savings_balance: string;
  investment_balance: string;
  emergency_fund_target_months: string;

  // Step 5: Goals & Risk
  primary_goal: PrimaryGoal | '';
  secondary_goal: PrimaryGoal | '';
  desired_retirement_age: string;
  passive_income_target: string;
  risk_tolerance: RiskTolerance | '';
}
