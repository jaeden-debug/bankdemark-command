// ============================================================
// BankDeMark Command — Recommendation Engine
// Rule-based. Profile-aware. No fake logic.
// ============================================================

import type { FinancialSnapshot, FinancialMetrics, UserProfile, Recommendation } from './types';

export function generateRecommendations(
  profile: UserProfile,
  snapshot: FinancialSnapshot,
  metrics: FinancialMetrics
): Recommendation[] {
  const recs: Recommendation[] = [];

  // ——————————————————————————————————
  // CASH FLOW ISSUES
  // ——————————————————————————————————
  if (metrics.cash_flow_negative) {
    recs.push({
      key: 'negative_cash_flow_audit',
      category: 'cash_flow',
      priority: 'urgent',
      title: 'Your cash flow is negative — fix this first',
      description:
        'You are spending more than you earn each month. This is the most urgent financial issue to address. Review every expense line and cut non-essentials until cash flow is positive.',
      action_label: 'Review expenses in Debt Engine',
      action_href: '/command/debt',
      icon: '🚨',
    });
    recs.push({
      key: 'negative_cash_flow_no_debt',
      category: 'cash_flow',
      priority: 'urgent',
      title: 'Do not take on any new debt right now',
      description:
        'With negative cash flow, any new debt obligation will worsen your situation. Pause all credit applications until cash flow is stable.',
      action_label: 'See debt strategy',
      action_href: '/command/debt',
      icon: '⛔',
    });
  } else if (metrics.savings_rate < 0.05) {
    recs.push({
      key: 'low_savings_rate',
      category: 'cash_flow',
      priority: 'high',
      title: 'Your savings rate is very low',
      description:
        'Saving less than 5% of your income puts you at risk. Aim for at least 10–20%. Even small increases compound significantly over time.',
      action_label: 'Optimize your wealth plan',
      action_href: '/command/wealth',
      icon: '📉',
    });
  }

  // ——————————————————————————————————
  // EMERGENCY FUND
  // ——————————————————————————————————
  if (metrics.emergency_status === 'critical') {
    recs.push({
      key: 'emergency_fund_critical',
      category: 'emergency',
      priority: 'urgent',
      title: 'Build an emergency fund immediately',
      description:
        'You have less than 1 month of expenses saved. One unexpected event — job loss, car repair, medical bill — could create a financial crisis. Start a $1,000 starter fund today.',
      action_label: 'Find a high-interest savings account',
      action_href: '/best-savings-accounts-canada',
      icon: '🆘',
    });
  } else if (metrics.emergency_status === 'low') {
    recs.push({
      key: 'emergency_fund_low',
      category: 'emergency',
      priority: 'high',
      title: 'Grow your emergency fund to 3–6 months',
      description: `You have ${metrics.emergency_runway_months.toFixed(1)} months of expenses saved. Target ${snapshot.emergency_fund_target_months} months. Move this money to a high-interest savings account.`,
      action_label: 'Compare savings accounts',
      action_href: '/best-savings-accounts-canada',
      icon: '💰',
    });
  }

  // ——————————————————————————————————
  // DEBT
  // ——————————————————————————————————
  if (metrics.high_interest_debt_flag && snapshot.total_debt > 0) {
    recs.push({
      key: 'high_interest_debt',
      category: 'debt',
      priority: 'high',
      title: 'Attack high-interest debt aggressively',
      description: `Your average debt interest rate of ${snapshot.average_debt_interest}% is high. High-interest debt destroys wealth. Use the avalanche method to pay it down as fast as possible.`,
      action_label: 'Use Debt Engine',
      action_href: '/command/debt',
      icon: '🔥',
    });
    if (snapshot.credit_score_range === 'good' || snapshot.credit_score_range === 'very_good' || snapshot.credit_score_range === 'excellent') {
      recs.push({
        key: 'balance_transfer',
        category: 'debt',
        priority: 'medium',
        title: 'Consider a balance transfer to 0% interest',
        description:
          'If your credit score qualifies, a balance transfer card can reduce your interest rate to 0% temporarily — letting you attack the principal faster.',
        action_label: 'Compare balance transfer cards',
        action_href: '/best-credit-cards-canada',
        icon: '💳',
      });
    }
  }

  if (metrics.dangerously_high_debt) {
    recs.push({
      key: 'dangerous_debt_load',
      category: 'debt',
      priority: 'urgent',
      title: 'Debt load is in the danger zone',
      description:
        'Your total debt exceeds 2x your annual income or your debt-to-income ratio is critically high. Consider debt consolidation options or a credit counselling consultation.',
      action_label: 'Debt consolidation guide',
      action_href: '/debt-consolidation-canada',
      icon: '⚠️',
    });
  }

  // ——————————————————————————————————
  // INVESTING
  // ——————————————————————————————————
  if (!metrics.cash_flow_negative && metrics.emergency_status !== 'critical' && snapshot.investment_balance === 0) {
    recs.push({
      key: 'start_investing',
      category: 'investing',
      priority: 'high',
      title: 'Start investing — even a small amount',
      description:
        'You have no current investments. The best time to start was yesterday. Open a TFSA or RRSP and begin with as little as $50/month. Compound growth is your most powerful tool.',
      action_label: 'Compare investment platforms',
      action_href: '/command/wealth',
      icon: '📈',
    });
  }

  if (snapshot.primary_goal === 'achieve_fire' || snapshot.primary_goal === 'retire_early') {
    recs.push({
      key: 'fire_strategy',
      category: 'investing',
      priority: 'high',
      title: 'Build your FIRE strategy',
      description: `Your FIRE number is estimated at ${formatDollar(metrics.fire_number)}. Use the Wealth Engine to simulate your path to financial independence.`,
      action_label: 'Open Wealth Engine',
      action_href: '/command/wealth',
      icon: '🔥',
    });
  }

  if (profile.country === 'Canada' || profile.country === 'CA') {
    recs.push({
      key: 'canadian_registered_accounts',
      category: 'investing',
      priority: 'medium',
      title: 'Maximize your registered accounts (TFSA, RRSP, FHSA)',
      description:
        'Canadian registered accounts provide tax-free or tax-deferred growth. TFSA first for flexibility, RRSP if you want a tax deduction, FHSA if buying your first home.',
      action_label: 'TFSA vs RRSP comparison',
      action_href: '/tfsa-vs-rrsp',
      icon: '🍁',
    });
  }

  // ——————————————————————————————————
  // RETIREMENT
  // ——————————————————————————————————
  if (metrics.near_retirement_underfunded) {
    recs.push({
      key: 'near_retirement_gap',
      category: 'investing',
      priority: 'urgent',
      title: 'Retirement is close — significant gap detected',
      description: `You are within ${metrics.years_to_retirement} years of retirement with an estimated gap of ${formatDollar(metrics.retirement_gap)}. Maximize contributions immediately.`,
      action_label: 'Retirement calculator',
      action_href: '/retirement-calculator-canada',
      icon: '🕐',
    });
  }

  // ——————————————————————————————————
  // BUSINESS OWNER
  // ——————————————————————————————————
  if (profile.business_owner) {
    recs.push({
      key: 'business_account_separation',
      category: 'business',
      priority: 'high',
      title: 'Separate business and personal finances',
      description:
        'Mixing business and personal money creates tax and legal headaches. Open a dedicated business bank account immediately.',
      action_label: 'Compare business accounts',
      action_href: '/best-business-bank-accounts-canada',
      icon: '🏢',
    });
    recs.push({
      key: 'business_tax_planning',
      category: 'tax',
      priority: 'medium',
      title: 'Plan your business taxes proactively',
      description:
        'As a business owner, you have more tax optimization options than employees — salary vs. dividends, HST, deductions. Plan ahead to avoid surprises.',
      action_label: 'Business tax calculator',
      action_href: '/small-business-tax-calculator-canada',
      icon: '📋',
    });
  }

  // ——————————————————————————————————
  // HOMEBUYING
  // ——————————————————————————————————
  if (snapshot.primary_goal === 'save_for_home') {
    recs.push({
      key: 'home_affordability',
      category: 'investing',
      priority: 'high',
      title: 'Calculate exactly what home you can afford',
      description:
        'Use the mortgage affordability tool to determine your safe purchase price, required down payment, and monthly payment impact.',
      action_label: 'Mortgage affordability calculator',
      action_href: '/mortgage-affordability-canada',
      icon: '🏠',
    });
    if (profile.country === 'Canada' || profile.country === 'CA') {
      recs.push({
        key: 'fhsa_canada',
        category: 'investing',
        priority: 'high',
        title: 'Open a First Home Savings Account (FHSA)',
        description:
          'The FHSA gives you a tax deduction on contributions AND tax-free growth. You can contribute $8,000/year (up to $40,000 lifetime). This is the most powerful first-time buyer tool available.',
        action_label: 'TFSA vs RRSP vs FHSA guide',
        action_href: '/tfsa-vs-rrsp',
        icon: '🏡',
      });
    }
  }

  // ——————————————————————————————————
  // FREELANCER / VARIABLE INCOME
  // ——————————————————————————————————
  if (profile.user_type === 'freelancer') {
    recs.push({
      key: 'freelancer_tax_reserve',
      category: 'tax',
      priority: 'high',
      title: 'Set aside 25–35% of every payment for taxes',
      description:
        'As a freelancer, no taxes are withheld from your income. Save 25–35% of every payment in a separate account to cover income tax and CPP/EI obligations.',
      action_label: 'See AI Coach for guidance',
      action_href: '/command/coach',
      icon: '💼',
    });
  }

  // ——————————————————————————————————
  // CREDIT SCORE IMPROVEMENT
  // ——————————————————————————————————
  if (snapshot.credit_score_range === 'poor' || snapshot.credit_score_range === 'fair') {
    recs.push({
      key: 'improve_credit_score',
      category: 'debt',
      priority: 'medium',
      title: 'Improve your credit score',
      description:
        'A higher credit score unlocks lower interest rates on mortgages, car loans, and credit cards — saving you thousands. Pay on time, keep utilization below 30%, and avoid new credit applications.',
      action_label: 'Compare credit-building cards',
      action_href: '/best-credit-cards-canada',
      icon: '⭐',
    });
  }

  // Sort by priority
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs.slice(0, 8); // Return top 8 recommendations
}

// ============================================================
// Priority Stack
// ============================================================

export function generatePriorityStack(
  snapshot: FinancialSnapshot,
  metrics: FinancialMetrics
): string[] {
  const priorities: string[] = [];

  if (metrics.cash_flow_negative) {
    priorities.push('🚨 Fix negative cash flow immediately — cut expenses or increase income');
  }

  if (metrics.no_emergency_fund) {
    priorities.push('💰 Build a $1,000 starter emergency fund now');
  }

  if (metrics.high_interest_debt_flag && snapshot.total_debt > 0) {
    priorities.push('🔥 Attack high-interest debt using the avalanche method');
  } else if (snapshot.total_debt > 0) {
    priorities.push('📊 Continue systematic debt payoff');
  }

  if (metrics.emergency_status === 'low') {
    priorities.push('🏦 Grow emergency fund to 3 months of expenses');
  } else if (metrics.emergency_status === 'okay') {
    priorities.push('🏦 Build emergency fund to full 6-month target');
  }

  if (!metrics.cash_flow_negative && metrics.emergency_status !== 'critical' && snapshot.investment_balance === 0) {
    priorities.push('📈 Start investing — open a TFSA or RRSP today');
  } else if (!metrics.cash_flow_negative && metrics.savings_rate < 0.15) {
    priorities.push('📈 Increase your monthly investment contributions');
  }

  if (metrics.near_retirement_underfunded) {
    priorities.push('⏰ Close your retirement funding gap — maximize contributions now');
  }

  if (priorities.length < 3) {
    priorities.push('📊 Track net worth monthly and review this dashboard');
    priorities.push('🎯 Use AI Coach to get personalized next steps');
    priorities.push('🔁 Review and optimize your financial plan quarterly');
  }

  return priorities.slice(0, 6);
}

// ============================================================
// Risk Warnings
// ============================================================

export function generateRiskWarnings(
  snapshot: FinancialSnapshot,
  metrics: FinancialMetrics
): string[] {
  const warnings: string[] = [];

  if (metrics.cash_flow_negative) {
    warnings.push(`Your cash flow is -${formatDollar(Math.abs(metrics.monthly_cash_flow))}/month. Without correction, you'll exhaust reserves within months.`);
  }
  if (metrics.dangerously_high_debt) {
    warnings.push('Your total debt load is critically high relative to your income. New debt could trigger a debt spiral.');
  }
  if (metrics.no_emergency_fund) {
    warnings.push('You have no emergency fund. One unexpected expense could force you into high-interest debt.');
  }
  if (metrics.near_retirement_underfunded) {
    warnings.push(`You are ${metrics.years_to_retirement} years from retirement with a gap of ${formatDollar(metrics.retirement_gap)}. Immediate action required.`);
  }
  if (metrics.housing_ratio > 0.40) {
    warnings.push(`Your housing cost is ${(metrics.housing_ratio * 100).toFixed(0)}% of income. Recommended maximum is 30%.`);
  }
  if (metrics.high_interest_debt_flag && snapshot.total_debt > 0) {
    warnings.push(`High-interest debt at ${snapshot.average_debt_interest}% is actively destroying your wealth. Every month of delay costs more.`);
  }

  return warnings;
}

function formatDollar(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
