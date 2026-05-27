// ============================================================
// BankDeMark Command — Financial Calculation Engine
// Pure functions. Deterministic. No side effects.
// ============================================================

import type { FinancialSnapshot, FinancialMetrics, AffordabilityInput, AffordabilityResult, DebtPayoffResult, Debt, ScoreBand } from './types';
import { INVESTMENT_RETURNS, SAFE_WITHDRAWAL_RATE, FIRE_MULTIPLIER, DEBT_THRESHOLDS, SAVINGS_RATE_TARGETS, HEALTH_SCORE_WEIGHTS, SCORE_BANDS } from './constants';

// ============================================================
// Helpers
// ============================================================

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function safeDiv(numerator: number, denominator: number): number {
  if (!denominator || denominator === 0) return 0;
  return numerator / denominator;
}

export function roundTo(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function formatCurrency(value: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function addMonthsToDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long' });
}

// ============================================================
// Monthly Cash Flow
// ============================================================

export function calcMonthlyCashFlow(snapshot: FinancialSnapshot): number {
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);
  const totalExpenses =
    snapshot.fixed_expenses +
    snapshot.variable_expenses +
    snapshot.housing_payment +
    snapshot.minimum_debt_payment +
    (snapshot.business_expenses ?? 0);
  return totalIncome - totalExpenses;
}

export function calcAnnualCashFlow(snapshot: FinancialSnapshot): number {
  return calcMonthlyCashFlow(snapshot) * 12;
}

export function calcDiscretionaryIncome(snapshot: FinancialSnapshot): number {
  const cashFlow = calcMonthlyCashFlow(snapshot);
  return Math.max(0, cashFlow);
}

// ============================================================
// Savings Rate
// ============================================================

export function calcSavingsRate(snapshot: FinancialSnapshot): number {
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);
  if (totalIncome <= 0) return 0;
  const cashFlow = calcMonthlyCashFlow(snapshot);
  return clamp(safeDiv(cashFlow, totalIncome), -1, 1);
}

// ============================================================
// Emergency Fund
// ============================================================

export function calcEmergencyRunway(snapshot: FinancialSnapshot): number {
  const monthlyNeeds =
    snapshot.fixed_expenses +
    snapshot.variable_expenses +
    snapshot.housing_payment;
  if (monthlyNeeds <= 0) return 0;
  return safeDiv(snapshot.savings_balance, monthlyNeeds);
}

export function calcEmergencyFundTarget(snapshot: FinancialSnapshot): number {
  const monthlyNeeds =
    snapshot.fixed_expenses +
    snapshot.variable_expenses +
    snapshot.housing_payment;
  return monthlyNeeds * snapshot.emergency_fund_target_months;
}

export function calcEmergencyFundGap(snapshot: FinancialSnapshot): number {
  const target = calcEmergencyFundTarget(snapshot);
  return Math.max(0, target - snapshot.savings_balance);
}

export function calcEmergencyStatus(runway: number): 'critical' | 'low' | 'okay' | 'strong' {
  if (runway < 1) return 'critical';
  if (runway < 3) return 'low';
  if (runway < 6) return 'okay';
  return 'strong';
}

// ============================================================
// Net Worth
// ============================================================

export function calcNetWorth(snapshot: FinancialSnapshot): number {
  const assets = snapshot.savings_balance + snapshot.investment_balance;
  const liabilities = snapshot.total_debt;
  return assets - liabilities;
}

export function calcTotalAssets(snapshot: FinancialSnapshot): number {
  return snapshot.savings_balance + snapshot.investment_balance;
}

// ============================================================
// Debt Metrics
// ============================================================

export function calcDebtToIncomeRatio(snapshot: FinancialSnapshot): number {
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);
  if (totalIncome <= 0) return 0;
  return safeDiv(snapshot.minimum_debt_payment, totalIncome);
}

export function calcDebtPressureScore(snapshot: FinancialSnapshot): number {
  const dti = calcDebtToIncomeRatio(snapshot);
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);
  const annualIncome = totalIncome * 12;
  const totalDebtRatio = safeDiv(snapshot.total_debt, annualIncome || 1);
  const dtiScore = clamp(safeDiv(dti, 0.50), 0, 1) * 60;
  const totalDebtScore = clamp(safeDiv(totalDebtRatio, 3), 0, 1) * 40;
  return Math.round(dtiScore + totalDebtScore);
}

export function isHighInterestDebt(snapshot: FinancialSnapshot): boolean {
  return snapshot.average_debt_interest > DEBT_THRESHOLDS.high_interest_rate;
}

// Simplified debt payoff model (when no itemized debts available)
export function calcSimplifiedDebtPayoff(
  totalDebt: number,
  annualRate: number,
  monthlyPayment: number
): { months: number; totalInterest: number } {
  if (totalDebt <= 0 || monthlyPayment <= 0) return { months: 0, totalInterest: 0 };
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) {
    return {
      months: Math.ceil(safeDiv(totalDebt, monthlyPayment)),
      totalInterest: 0,
    };
  }
  const minPaymentToNotGrow = totalDebt * monthlyRate;
  if (monthlyPayment <= minPaymentToNotGrow) {
    // Payment doesn't cover interest — cap at 360 months
    return { months: 360, totalInterest: totalDebt * 3 };
  }
  const months = Math.ceil(
    -Math.log(1 - (monthlyRate * totalDebt) / monthlyPayment) / Math.log(1 + monthlyRate)
  );
  const totalPaid = monthlyPayment * months;
  const totalInterest = totalPaid - totalDebt;
  return { months: clamp(months, 0, 600), totalInterest: Math.max(0, totalInterest) };
}

// ============================================================
// Debt Payoff Strategies (Itemized)
// ============================================================

export function calcDebtAvalanche(
  debts: Debt[],
  extraMonthlyPayment: number
): DebtPayoffResult {
  if (debts.length === 0) return emptyPayoffResult('avalanche');
  const sorted = [...debts].sort((a, b) => b.interest_rate - a.interest_rate);
  return simulateDebtPayoff(sorted, extraMonthlyPayment, 'avalanche');
}

export function calcDebtSnowball(
  debts: Debt[],
  extraMonthlyPayment: number
): DebtPayoffResult {
  if (debts.length === 0) return emptyPayoffResult('snowball');
  const sorted = [...debts].sort((a, b) => a.balance - b.balance);
  return simulateDebtPayoff(sorted, extraMonthlyPayment, 'snowball');
}

function emptyPayoffResult(method: 'avalanche' | 'snowball'): DebtPayoffResult {
  return {
    method,
    months_to_payoff: 0,
    total_interest_paid: 0,
    monthly_attack_payment: 0,
    payoff_date: addMonthsToDate(0),
    payoff_order: [],
    interest_saved_vs_minimum: 0,
  };
}

function simulateDebtPayoff(
  debts: Debt[],
  extraPayment: number,
  method: 'avalanche' | 'snowball'
): DebtPayoffResult {
  const MAX_MONTHS = 600;
  let balances = debts.map(d => d.balance);
  const rates = debts.map(d => d.interest_rate / 100 / 12);
  const minPayments = debts.map(d => d.minimum_payment);
  const totalMinPayment = minPayments.reduce((a, b) => a + b, 0);
  const monthlyPayment = totalMinPayment + extraPayment;
  let totalInterest = 0;
  let month = 0;
  const payoffOrder: { name: string; months: number; interest: number }[] = [];
  let debtInterests = debts.map(() => 0);

  while (balances.some(b => b > 0) && month < MAX_MONTHS) {
    month++;
    let availableExtra = extraPayment;

    // Apply interest and minimum payments
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] <= 0) continue;
      const interest = balances[i] * rates[i];
      totalInterest += interest;
      debtInterests[i] += interest;
      balances[i] += interest;
      const payment = Math.min(minPayments[i], balances[i]);
      balances[i] -= payment;
      if (balances[i] < 0.01) balances[i] = 0;
    }

    // Apply extra payment to first non-zero debt in order
    for (let i = 0; i < balances.length; i++) {
      if (balances[i] <= 0) continue;
      const payment = Math.min(availableExtra, balances[i]);
      balances[i] -= payment;
      availableExtra -= payment;
      if (balances[i] < 0.01) {
        if (!payoffOrder.find(p => p.name === debts[i].name)) {
          payoffOrder.push({ name: debts[i].name, months: month, interest: Math.round(debtInterests[i]) });
        }
        balances[i] = 0;
      }
      if (availableExtra <= 0) break;
    }
  }

  // Minimum-only baseline for interest saved calculation
  let minTotalInterest = 0;
  const minBalances = debts.map(d => d.balance);
  let minMonth = 0;
  while (minBalances.some(b => b > 0) && minMonth < MAX_MONTHS) {
    minMonth++;
    for (let i = 0; i < minBalances.length; i++) {
      if (minBalances[i] <= 0) continue;
      const interest = minBalances[i] * rates[i];
      minTotalInterest += interest;
      minBalances[i] += interest;
      const payment = Math.min(minPayments[i], minBalances[i]);
      minBalances[i] -= payment;
      if (minBalances[i] < 0.01) minBalances[i] = 0;
    }
  }

  return {
    method,
    months_to_payoff: month,
    total_interest_paid: Math.round(totalInterest),
    monthly_attack_payment: monthlyPayment,
    payoff_date: addMonthsToDate(month),
    payoff_order: payoffOrder,
    interest_saved_vs_minimum: Math.max(0, Math.round(minTotalInterest - totalInterest)),
  };
}

// ============================================================
// FIRE & Retirement
// ============================================================

export function calcFIRENumber(snapshot: FinancialSnapshot): number {
  const annualExpenses =
    (snapshot.fixed_expenses + snapshot.variable_expenses + snapshot.housing_payment) * 12;
  return annualExpenses * FIRE_MULTIPLIER;
}

export function calcRetirementGap(snapshot: FinancialSnapshot): number {
  const fireNumber = calcFIRENumber(snapshot);
  const currentInvestments = snapshot.investment_balance + snapshot.savings_balance;
  return Math.max(0, fireNumber - currentInvestments);
}

export function calcYearsToRetirement(snapshot: FinancialSnapshot): number {
  const currentAge = snapshot.desired_retirement_age
    ? snapshot.desired_retirement_age - (snapshot as any).age
    : 30;
  return Math.max(0, currentAge);
}

export function calcPassiveIncomeCapitalNeeded(snapshot: FinancialSnapshot): number {
  if (!snapshot.passive_income_target || snapshot.passive_income_target <= 0) return 0;
  const annualTarget = snapshot.passive_income_target * 12;
  return annualTarget / SAFE_WITHDRAWAL_RATE;
}

export function calcMonthlyPassiveIncomeProjected(snapshot: FinancialSnapshot): number {
  const currentInvestments = snapshot.investment_balance;
  return (currentInvestments * SAFE_WITHDRAWAL_RATE) / 12;
}

// ============================================================
// Investment Projections
// ============================================================

export function calcFutureValue(
  presentValue: number,
  monthlyContribution: number,
  annualRate: number,
  years: number
): number {
  const months = years * 12;
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) return presentValue + monthlyContribution * months;
  const fvLumpSum = presentValue * Math.pow(1 + monthlyRate, months);
  const fvContributions =
    monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
  return fvLumpSum + fvContributions;
}

export function calcMonthlyInvestmentNeeded(
  targetAmount: number,
  currentAmount: number,
  annualRate: number,
  years: number
): number {
  if (years <= 0) return 0;
  const months = years * 12;
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) {
    return Math.max(0, (targetAmount - currentAmount) / months);
  }
  const fvCurrent = currentAmount * Math.pow(1 + monthlyRate, months);
  const remaining = targetAmount - fvCurrent;
  if (remaining <= 0) return 0;
  const annuityFactor = (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
  return Math.max(0, remaining / annuityFactor);
}

// ============================================================
// Housing Ratio
// ============================================================

export function calcHousingRatio(snapshot: FinancialSnapshot): number {
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);
  return safeDiv(snapshot.housing_payment, totalIncome);
}

// ============================================================
// Affordability Engine
// ============================================================

export function calcAffordability(
  input: AffordabilityInput,
  snapshot: FinancialSnapshot,
  metrics: FinancialMetrics
): AffordabilityResult {
  const cashFlowImpact = -input.monthly_payment;
  const newCashFlow = metrics.monthly_cash_flow + cashFlowImpact;
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);

  // New debt pressure
  const newMinDebtPayment = snapshot.minimum_debt_payment + input.monthly_payment;
  const newDebtPressure = safeDiv(newMinDebtPayment, totalIncome);

  // Emergency fund runway after potential down payment
  const newSavings = Math.max(0, snapshot.savings_balance - input.down_payment);
  const monthlyNeeds = snapshot.fixed_expenses + snapshot.variable_expenses + snapshot.housing_payment;
  const newRunway = safeDiv(newSavings, monthlyNeeds);

  // Recommended max safe payment
  const maxSafeDebtPayment = totalIncome * 0.15 - snapshot.minimum_debt_payment;
  const recommendedMax = Math.max(0, maxSafeDebtPayment);

  const reasons: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // Cash flow check
  if (newCashFlow < 0) {
    score -= 40;
    reasons.push('This payment would make your monthly cash flow negative.');
    suggestions.push('Consider a smaller payment, longer term, or larger down payment.');
  } else if (newCashFlow < totalIncome * 0.05) {
    score -= 20;
    reasons.push('This payment would leave very little monthly buffer.');
    suggestions.push('Aim to keep at least 10% of income as monthly buffer.');
  }

  // Debt pressure check
  if (newDebtPressure > 0.35) {
    score -= 30;
    reasons.push('Your total debt payments would exceed 35% of income (danger zone).');
    suggestions.push('Pay down existing debt before taking on this payment.');
  } else if (newDebtPressure > 0.20) {
    score -= 15;
    reasons.push('Your total debt payments would exceed 20% of income.');
    suggestions.push('Consider reducing other debts first.');
  }

  // Emergency fund check
  if (newRunway < 1) {
    score -= 20;
    reasons.push('After this purchase, your emergency fund would cover less than 1 month.');
    suggestions.push('Build at least 3 months emergency reserves before this purchase.');
  } else if (newRunway < 3) {
    score -= 10;
    reasons.push('Your emergency runway would drop below 3 months.');
    suggestions.push('Ensure you have at least 3–6 months of expenses saved.');
  }

  // Existing financial stress check
  if (metrics.health_score < 40) {
    score -= 20;
    reasons.push('Your overall financial health score is in the critical range.');
    suggestions.push('Stabilize your finances before taking on new obligations.');
  }

  score = clamp(score, 0, 100);

  let verdict: AffordabilityResult['verdict'];
  let verdict_label: string;
  let verdict_color: string;

  if (score >= 70) {
    verdict = 'affordable';
    verdict_label = 'Affordable';
    verdict_color = '#00D084';
  } else if (score >= 40) {
    verdict = 'risky';
    verdict_label = 'Risky';
    verdict_color = '#F5C842';
  } else {
    verdict = 'not_recommended';
    verdict_label = 'Not Recommended';
    verdict_color = '#EF4444';
  }

  if (reasons.length === 0) {
    reasons.push('Your cash flow, debt load, and emergency fund can support this payment.');
  }

  return {
    verdict,
    verdict_label,
    verdict_color,
    score,
    cash_flow_impact: cashFlowImpact,
    new_monthly_cash_flow: newCashFlow,
    emergency_fund_months_remaining: roundTo(newRunway, 1),
    new_debt_pressure: roundTo(newDebtPressure * 100, 1),
    recommended_max_payment: Math.round(recommendedMax),
    reasons,
    suggestions,
  };
}

// ============================================================
// Financial Health Score
// ============================================================

export function calcHealthScore(snapshot: FinancialSnapshot): { score: number; band: ScoreBand; label: string; breakdown: Record<string, number> } {
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);

  // 1. Cash flow component (25%)
  const cashFlow = calcMonthlyCashFlow(snapshot);
  const cashFlowRatio = safeDiv(cashFlow, totalIncome || 1);
  const cashFlowScore =
    cashFlowRatio >= 0.20 ? 100 :
    cashFlowRatio >= 0.10 ? 80 :
    cashFlowRatio >= 0.05 ? 60 :
    cashFlowRatio >= 0 ? 40 :
    cashFlowRatio >= -0.10 ? 15 : 0;

  // 2. Emergency runway component (20%)
  const runway = calcEmergencyRunway(snapshot);
  const emergencyScore =
    runway >= 6 ? 100 :
    runway >= 3 ? 80 :
    runway >= 1 ? 50 :
    runway >= 0.5 ? 25 : 0;

  // 3. Debt pressure component (20%)
  const dti = calcDebtToIncomeRatio(snapshot);
  const debtScore =
    dti === 0 ? 100 :
    dti <= 0.10 ? 90 :
    dti <= 0.15 ? 75 :
    dti <= 0.20 ? 60 :
    dti <= 0.30 ? 40 :
    dti <= 0.40 ? 20 : 5;

  // 4. Savings rate component (15%)
  const savingsRate = calcSavingsRate(snapshot);
  const savingsScore =
    savingsRate >= 0.30 ? 100 :
    savingsRate >= 0.20 ? 85 :
    savingsRate >= 0.10 ? 65 :
    savingsRate >= 0.05 ? 45 :
    savingsRate >= 0 ? 25 : 5;

  // 5. Investment progress component (10%)
  const annualIncome = totalIncome * 12;
  const investmentRatio = safeDiv(snapshot.investment_balance, annualIncome || 1);
  const investmentScore =
    investmentRatio >= 3 ? 100 :
    investmentRatio >= 1 ? 80 :
    investmentRatio >= 0.5 ? 60 :
    investmentRatio >= 0.1 ? 40 :
    investmentRatio > 0 ? 20 : 5;

  // 6. Profile completeness / goal clarity (10%)
  const hasGoal = snapshot.primary_goal ? 1 : 0;
  const hasRetirementAge = snapshot.desired_retirement_age > 0 ? 1 : 0;
  const hasRisk = snapshot.risk_tolerance ? 1 : 0;
  const hasCredit = snapshot.credit_score_range ? 1 : 0;
  const profileScore = ((hasGoal + hasRetirementAge + hasRisk + hasCredit) / 4) * 100;

  const rawScore =
    cashFlowScore * HEALTH_SCORE_WEIGHTS.cash_flow +
    emergencyScore * HEALTH_SCORE_WEIGHTS.emergency_runway +
    debtScore * HEALTH_SCORE_WEIGHTS.debt_pressure +
    savingsScore * HEALTH_SCORE_WEIGHTS.savings_rate +
    investmentScore * HEALTH_SCORE_WEIGHTS.investment_progress +
    profileScore * HEALTH_SCORE_WEIGHTS.profile_completeness;

  const score = Math.round(clamp(rawScore, 0, 100));
  const band = SCORE_BANDS.find(b => score >= b.min && score <= b.max)?.band ?? 'critical' as ScoreBand;
  const label = SCORE_BANDS.find(b => score >= b.min && score <= b.max)?.label ?? 'Critical';

  return {
    score,
    band,
    label,
    breakdown: {
      cash_flow: Math.round(cashFlowScore),
      emergency_runway: Math.round(emergencyScore),
      debt_pressure: Math.round(debtScore),
      savings_rate: Math.round(savingsScore),
      investment_progress: Math.round(investmentScore),
      profile_completeness: Math.round(profileScore),
    },
  };
}

// ============================================================
// Master Metrics Calculator
// ============================================================

export function calcAllMetrics(snapshot: FinancialSnapshot, userAge?: number): FinancialMetrics {
  const totalIncome = snapshot.monthly_income + (snapshot.business_revenue ?? 0);
  const annualIncome = totalIncome * 12;

  const monthly_cash_flow = calcMonthlyCashFlow(snapshot);
  const annual_cash_flow = monthly_cash_flow * 12;
  const discretionary_income = Math.max(0, monthly_cash_flow);

  const savings_rate = calcSavingsRate(snapshot);
  const debt_to_income_ratio = calcDebtToIncomeRatio(snapshot);
  const housing_ratio = calcHousingRatio(snapshot);

  const emergency_runway_months = roundTo(calcEmergencyRunway(snapshot), 1);
  const emergency_fund_target = calcEmergencyFundTarget(snapshot);
  const emergency_fund_gap = calcEmergencyFundGap(snapshot);
  const emergency_status = calcEmergencyStatus(emergency_runway_months);

  const net_worth = calcNetWorth(snapshot);
  const total_assets = calcTotalAssets(snapshot);
  const total_liabilities = snapshot.total_debt;

  const debt_pressure_score = calcDebtPressureScore(snapshot);
  const high_interest_debt_flag = isHighInterestDebt(snapshot);

  // Simplified debt payoff
  const attackPayment = Math.max(
    snapshot.minimum_debt_payment,
    snapshot.minimum_debt_payment + Math.max(0, monthly_cash_flow * 0.5)
  );
  const { months: debtFreeMonths, totalInterest } = calcSimplifiedDebtPayoff(
    snapshot.total_debt,
    snapshot.average_debt_interest,
    attackPayment
  );
  const debt_free_months = debtFreeMonths;
  const total_interest_cost = totalInterest;

  const fire_number = calcFIRENumber(snapshot);
  const retirement_gap = calcRetirementGap(snapshot);

  const currentAge = userAge ?? 35;
  const retirementAge = snapshot.desired_retirement_age || 65;
  const years_to_retirement = Math.max(0, retirementAge - currentAge);

  // Monthly investment needed to close gap
  const monthly_investment_needed = calcMonthlyInvestmentNeeded(
    fire_number,
    snapshot.investment_balance + snapshot.savings_balance,
    INVESTMENT_RETURNS.moderate,
    years_to_retirement
  );

  // 10-year projections
  const extraMonthly = Math.max(0, monthly_cash_flow * 0.3);
  const projection_conservative = calcFutureValue(
    snapshot.investment_balance,
    extraMonthly,
    INVESTMENT_RETURNS.conservative,
    10
  );
  const projection_moderate = calcFutureValue(
    snapshot.investment_balance,
    extraMonthly,
    INVESTMENT_RETURNS.moderate,
    10
  );
  const projection_aggressive = calcFutureValue(
    snapshot.investment_balance,
    extraMonthly,
    INVESTMENT_RETURNS.aggressive,
    10
  );

  const passive_income_capital_needed = calcPassiveIncomeCapitalNeeded(snapshot);
  const monthly_passive_income_projected = calcMonthlyPassiveIncomeProjected(snapshot);

  const { score: health_score, band: health_band, label: health_label } = calcHealthScore(snapshot);

  // Max safe payment (15% of income minus existing debt obligations)
  const max_safe_monthly_payment = Math.max(
    0,
    totalIncome * 0.15 - snapshot.minimum_debt_payment
  );

  // Flags
  const cash_flow_negative = monthly_cash_flow < 0;
  const dangerously_high_debt = debt_to_income_ratio > 0.40 || snapshot.total_debt > annualIncome * 2;
  const no_emergency_fund = emergency_runway_months < 1;
  const near_retirement_underfunded =
    years_to_retirement <= 10 && retirement_gap > annualIncome * 2;

  return {
    monthly_cash_flow,
    annual_cash_flow,
    discretionary_income,
    savings_rate,
    debt_to_income_ratio,
    housing_ratio,
    emergency_runway_months,
    emergency_fund_target,
    emergency_fund_gap,
    emergency_status,
    net_worth,
    total_assets,
    total_liabilities,
    debt_pressure_score,
    debt_free_months,
    total_interest_cost,
    high_interest_debt_flag,
    fire_number,
    retirement_gap,
    years_to_retirement,
    monthly_investment_needed,
    projection_conservative: Math.round(projection_conservative),
    projection_moderate: Math.round(projection_moderate),
    projection_aggressive: Math.round(projection_aggressive),
    passive_income_capital_needed: Math.round(passive_income_capital_needed),
    monthly_passive_income_projected: Math.round(monthly_passive_income_projected),
    health_score,
    health_band,
    health_label,
    max_safe_monthly_payment: Math.round(max_safe_monthly_payment),
    cash_flow_negative,
    dangerously_high_debt,
    no_emergency_fund,
    near_retirement_underfunded,
  };
}
