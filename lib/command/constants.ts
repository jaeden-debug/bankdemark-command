// ============================================================
// BankDeMark Command — Constants & Configuration
// ============================================================

import type { UserType, HouseholdType, RiskTolerance, CreditScoreRange, PrimaryGoal, DebtType } from './types';

// ============================================================
// Financial Assumptions
// ============================================================

export const INVESTMENT_RETURNS = {
  conservative: 0.04,  // 4% annual
  moderate: 0.07,      // 7% annual
  aggressive: 0.10,    // 10% annual
} as const;

export const SAFE_WITHDRAWAL_RATE = 0.04; // 4% SWR for FIRE
export const FIRE_MULTIPLIER = 25;        // 25x annual expenses

export const EMERGENCY_FUND_TARGETS = {
  minimum: 1,
  standard: 3,
  recommended: 6,
  conservative: 9,
} as const;

export const DEBT_THRESHOLDS = {
  high_pressure: 0.20,      // >20% DTI = high pressure
  danger_zone: 0.35,        // >35% DTI = danger
  high_interest_rate: 0.10, // >10% = high interest debt
} as const;

export const SAVINGS_RATE_TARGETS = {
  minimum: 0.10,    // 10%
  good: 0.20,       // 20%
  excellent: 0.30,  // 30%
} as const;

export const HOUSING_RATIO_MAX = 0.30; // 30% of gross income

// ============================================================
// Score Weights
// ============================================================

export const HEALTH_SCORE_WEIGHTS = {
  cash_flow: 0.25,
  emergency_runway: 0.20,
  debt_pressure: 0.20,
  savings_rate: 0.15,
  investment_progress: 0.10,
  profile_completeness: 0.10,
} as const;

// ============================================================
// Score Bands
// ============================================================

export const SCORE_BANDS = [
  { min: 0,  max: 39,  band: 'critical',   label: 'Critical',   color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  { min: 40, max: 59,  band: 'vulnerable', label: 'Vulnerable', color: '#F97316', bg: 'rgba(249,115,22,0.1)' },
  { min: 60, max: 74,  band: 'stable',     label: 'Stable',     color: '#EAB308', bg: 'rgba(234,179,8,0.1)' },
  { min: 75, max: 89,  band: 'strong',     label: 'Strong',     color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  { min: 90, max: 100, band: 'elite',      label: 'Elite',      color: '#00D084', bg: 'rgba(0,208,132,0.1)' },
] as const;

// ============================================================
// User Type Labels
// ============================================================

export const USER_TYPE_LABELS: Record<UserType, string> = {
  individual: 'Individual',
  student: 'Student',
  couple: 'Couple',
  family: 'Family',
  freelancer: 'Freelancer / Self-Employed',
  small_business: 'Small Business Owner',
  investor: 'Investor',
  retiree: 'Retiree / Retirement Planner',
};

export const HOUSEHOLD_TYPE_LABELS: Record<HouseholdType, string> = {
  single: 'Single',
  couple: 'Couple',
  family: 'Family with Children',
  other: 'Other',
};

export const RISK_TOLERANCE_LABELS: Record<RiskTolerance, string> = {
  conservative: 'Conservative — Capital preservation, low risk',
  moderate: 'Moderate — Balanced growth and stability',
  aggressive: 'Aggressive — Maximum growth, higher volatility',
};

export const CREDIT_SCORE_LABELS: Record<CreditScoreRange, string> = {
  poor: 'Poor (Under 580)',
  fair: 'Fair (580–669)',
  good: 'Good (670–739)',
  very_good: 'Very Good (740–799)',
  excellent: 'Excellent (800+)',
};

export const PRIMARY_GOAL_LABELS: Record<PrimaryGoal, string> = {
  pay_off_debt: 'Pay Off Debt',
  build_emergency_fund: 'Build Emergency Fund',
  save_for_home: 'Save for a Home',
  grow_investments: 'Grow My Investments',
  retire_early: 'Retire Early',
  start_business: 'Start or Grow a Business',
  increase_income: 'Increase My Income',
  achieve_fire: 'Achieve Financial Independence (FIRE)',
  reduce_expenses: 'Reduce Monthly Expenses',
};

export const DEBT_TYPE_LABELS: Record<DebtType, string> = {
  credit_card: 'Credit Card',
  student_loan: 'Student Loan',
  auto_loan: 'Auto Loan',
  personal_loan: 'Personal Loan',
  mortgage: 'Mortgage',
  heloc: 'HELOC / Line of Credit',
  business_loan: 'Business Loan',
  other: 'Other',
};

// ============================================================
// Marketplace Products — Edit to add real affiliate links
// ============================================================

export const MARKETPLACE_PRODUCTS = [
  {
    id: 'hisa-ca-1',
    category: 'Savings Accounts',
    name: 'High-Interest Savings Account',
    tagline: 'Earn more on your emergency fund',
    description: 'Park your emergency fund in a high-interest savings account and earn competitive rates while keeping full access to your money.',
    features: ['No monthly fees', 'No minimum balance', 'CDIC/CIPF insured', 'Instant transfers'],
    cta_label: 'Compare Top Accounts',
    cta_href: '/best-savings-accounts-canada', // Replace with affiliate link
    badge: 'Popular',
    sponsored: false,
  },
  {
    id: 'btc-ca-1',
    category: 'Balance Transfer',
    name: 'Balance Transfer Credit Card',
    tagline: 'Reduce high-interest debt to 0%',
    description: 'Transfer high-interest credit card debt to a 0% promotional rate card and attack the principal faster.',
    features: ['0% intro period', 'Low transfer fee', 'No annual fee options', 'Instant approval'],
    cta_label: 'Compare Balance Transfer Cards',
    cta_href: '/best-credit-cards-canada', // Replace with affiliate link
    badge: 'Debt Buster',
    sponsored: false,
  },
  {
    id: 'invest-ca-1',
    category: 'Investing',
    name: 'Brokerage / Robo-Advisor',
    tagline: 'Start investing with zero commissions',
    description: 'Open a TFSA, RRSP, or FHSA with a commission-free brokerage or automated robo-advisor.',
    features: ['$0 trading commissions', 'TFSA/RRSP/FHSA accounts', 'Automated rebalancing', 'Fractional shares'],
    cta_label: 'Compare Investment Platforms',
    cta_href: '/best-investing-platforms-canada', // Replace with affiliate link
    badge: undefined,
    sponsored: false,
  },
  {
    id: 'biz-ca-1',
    category: 'Business Banking',
    name: 'Business Bank Account',
    tagline: 'Separate business and personal finances',
    description: 'Open a dedicated business chequing account with low fees and powerful expense tracking tools.',
    features: ['Low monthly fee', 'Unlimited transactions', 'Interac e-Transfer', 'Accounting integrations'],
    cta_label: 'Compare Business Accounts',
    cta_href: '/best-business-bank-accounts-canada', // Replace with affiliate link
    badge: undefined,
    sponsored: false,
  },
  {
    id: 'mortgage-ca-1',
    category: 'Mortgage',
    name: 'Mortgage Pre-Approval',
    tagline: 'Know exactly how much home you can afford',
    description: 'Get pre-approved and compare mortgage rates from multiple lenders in minutes.',
    features: ['Compare 30+ lenders', 'Best-rate guarantee', 'No credit score impact', 'Free to apply'],
    cta_label: 'Compare Mortgage Rates',
    cta_href: '/mortgage-affordability-canada', // Replace with affiliate link
    badge: undefined,
    sponsored: false,
  },
  {
    id: 'tax-ca-1',
    category: 'Tax Planning',
    name: 'Tax Filing & Planning Software',
    tagline: 'Maximize your refund and minimize taxes',
    description: 'File your taxes and optimize contributions to RRSP, TFSA, and FHSA to reduce your tax bill.',
    features: ['CRA NETFILE certified', 'RRSP optimizer', 'T4 auto-fill', 'Refund estimator'],
    cta_label: 'Compare Tax Software',
    cta_href: '/best-tax-software-canada', // Replace with affiliate link
    badge: undefined,
    sponsored: false,
  },
] as const;

// ============================================================
// SEO Lead Pages (internal link cards)
// ============================================================

export const SEO_LEAD_PAGES = [
  { slug: '/best-credit-cards-canada', title: 'Best Credit Cards in Canada', description: 'Compare top rewards, cashback, and low-interest cards.' },
  { slug: '/best-savings-accounts-canada', title: 'Best High-Interest Savings Accounts', description: 'Find the highest rates on your emergency fund.' },
  { slug: '/best-business-bank-accounts-canada', title: 'Best Business Bank Accounts', description: 'Zero-fee and low-fee business chequing accounts.' },
  { slug: '/debt-consolidation-canada', title: 'Debt Consolidation Guide', description: 'Combine high-interest debt into one manageable payment.' },
  { slug: '/mortgage-affordability-canada', title: 'Mortgage Affordability Calculator', description: 'Know exactly how much home you can afford.' },
  { slug: '/tfsa-vs-rrsp', title: 'TFSA vs RRSP Comparison', description: 'Which registered account should you prioritize?' },
  { slug: '/financial-freedom-calculator', title: 'Financial Freedom Calculator', description: 'Calculate your FIRE number and retirement timeline.' },
  { slug: '/compound-interest-calculator', title: 'Compound Interest Calculator', description: 'See how your money grows over time.' },
  { slug: '/retirement-calculator-canada', title: 'Retirement Calculator Canada', description: 'Plan your CPP, OAS, and RRSP retirement income.' },
  { slug: '/small-business-tax-calculator-canada', title: 'Small Business Tax Calculator', description: 'Estimate your corporate and personal tax obligations.' },
] as const;

// ============================================================
// AI Suggested Questions by User Type
// ============================================================

export const AI_SUGGESTED_QUESTIONS: Partial<Record<UserType | 'default', string[]>> = {
  default: [
    'What should I fix first with my finances?',
    'How do I build a 6-month emergency fund?',
    'Should I pay off debt or invest right now?',
    'What is my biggest financial risk?',
    'How long will it take me to become debt-free?',
  ],
  student: [
    'How should I handle student loan debt?',
    'What is the best way to start investing as a student?',
    'How do I build credit responsibly?',
    'Should I open a TFSA or RRSP first?',
    'How do I create a budget on a tight student income?',
  ],
  investor: [
    'What is my FIRE number based on my current expenses?',
    'Am I on track for financial independence?',
    'How much do I need to invest monthly to retire at 50?',
    'What is the best asset allocation for my risk tolerance?',
    'How do I optimize my TFSA, RRSP, and non-registered accounts?',
  ],
  small_business: [
    'How much should I set aside for taxes as a business owner?',
    'What is the smartest way to pay myself — salary or dividends?',
    'How do I separate business and personal finances?',
    'How much business emergency reserve should I have?',
    'Should I incorporate my business?',
  ],
  freelancer: [
    'How do I calculate my quarterly tax instalments?',
    'How much should I save for taxes as a freelancer?',
    'How do I smooth out irregular income for budgeting?',
    'What is the right emergency fund size for variable income?',
    'How do I build retirement savings without an employer plan?',
  ],
  retiree: [
    'How do I make my retirement savings last 30 years?',
    'What is the best withdrawal sequence from my accounts?',
    'How do I calculate my sustainable monthly withdrawal?',
    'When should I start collecting CPP and OAS?',
    'How do I protect my portfolio from a market downturn in retirement?',
  ],
};
