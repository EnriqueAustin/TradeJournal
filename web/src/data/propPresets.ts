export type DrawdownType = 'trailing' | 'static';

export interface PropPhaseRules {
  profit_target_pct: number;
  daily_loss_pct: number;
  max_dd_pct: number;
  dd_type: DrawdownType;
  min_trading_days: number;
}

export interface PropPlanPreset {
  label: string;
  phases: PropPhaseRules[];
  funded: {
    daily_loss_pct: number;
    max_dd_pct: number;
    dd_type: DrawdownType;
    profit_split: number;
  };
  news_window_min: number;
  weekend_hold: boolean;
  consistency_pct: number | null;
  time_limit_days: number | null;
  min_hold_sec: number | null;
  hold_deduct_threshold_pct: number | null;
  safety_buffer_pct: number | null;
  max_inactivity_days: number | null;
  no_copy_trading: boolean;
  max_allocation: number | null;
  no_scaling: boolean;
}

export interface PropFirmPreset {
  name: string;
  plans: Record<string, PropPlanPreset>;
}

export const PROP_FIRMS: Record<string, PropFirmPreset> = {
  equity_edge: {
    name: 'Equity Edge',
    plans: {
      '1step_legacy': {
        label: '1-Step Legacy',
        phases: [
          { profit_target_pct: 10, daily_loss_pct: 4, max_dd_pct: 6, dd_type: 'trailing', min_trading_days: 2 },
        ],
        funded: { daily_loss_pct: 4, max_dd_pct: 6, dd_type: 'trailing', profit_split: 80 },
        news_window_min: 4,
        weekend_hold: true,
        consistency_pct: null,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: null,
        max_inactivity_days: null,
        no_copy_trading: false,
        max_allocation: null,
        no_scaling: false,
      },
      '1step_swift': {
        label: '1-Step Swift',
        phases: [
          { profit_target_pct: 8, daily_loss_pct: 3, max_dd_pct: 5, dd_type: 'trailing', min_trading_days: 2 },
        ],
        funded: { daily_loss_pct: 3, max_dd_pct: 5, dd_type: 'trailing', profit_split: 80 },
        news_window_min: 4,
        weekend_hold: true,
        consistency_pct: null,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: null,
        max_inactivity_days: null,
        no_copy_trading: false,
        max_allocation: null,
        no_scaling: false,
      },
      '1step_flagship': {
        label: '1-Step Flagship',
        phases: [
          { profit_target_pct: 10, daily_loss_pct: 4, max_dd_pct: 6, dd_type: 'trailing', min_trading_days: 2 },
        ],
        funded: { daily_loss_pct: 4, max_dd_pct: 6, dd_type: 'trailing', profit_split: 80 },
        news_window_min: 10,
        weekend_hold: true,
        consistency_pct: null,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: null,
        max_inactivity_days: null,
        no_copy_trading: false,
        max_allocation: null,
        no_scaling: false,
      },
      '2step_legacy': {
        label: '2-Step Legacy',
        phases: [
          { profit_target_pct: 10, daily_loss_pct: 5, max_dd_pct: 10, dd_type: 'static', min_trading_days: 2 },
          { profit_target_pct: 5, daily_loss_pct: 5, max_dd_pct: 10, dd_type: 'static', min_trading_days: 2 },
        ],
        funded: { daily_loss_pct: 5, max_dd_pct: 10, dd_type: 'static', profit_split: 80 },
        news_window_min: 4,
        weekend_hold: true,
        consistency_pct: null,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: null,
        max_inactivity_days: null,
        no_copy_trading: false,
        max_allocation: null,
        no_scaling: false,
      },
      '2step_swift': {
        label: '2-Step Swift',
        phases: [
          { profit_target_pct: 8, daily_loss_pct: 4, max_dd_pct: 8, dd_type: 'static', min_trading_days: 2 },
          { profit_target_pct: 5, daily_loss_pct: 4, max_dd_pct: 8, dd_type: 'static', min_trading_days: 2 },
        ],
        funded: { daily_loss_pct: 4, max_dd_pct: 8, dd_type: 'static', profit_split: 80 },
        news_window_min: 4,
        weekend_hold: true,
        consistency_pct: null,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: null,
        max_inactivity_days: null,
        no_copy_trading: false,
        max_allocation: null,
        no_scaling: false,
      },
      '2step_flagship': {
        label: '2-Step Flagship',
        phases: [
          { profit_target_pct: 8, daily_loss_pct: 4, max_dd_pct: 10, dd_type: 'static', min_trading_days: 3 },
          { profit_target_pct: 5, daily_loss_pct: 4, max_dd_pct: 10, dd_type: 'static', min_trading_days: 3 },
        ],
        funded: { daily_loss_pct: 4, max_dd_pct: 10, dd_type: 'static', profit_split: 80 },
        news_window_min: 10,
        weekend_hold: true,
        consistency_pct: null,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: null,
        max_inactivity_days: null,
        no_copy_trading: false,
        max_allocation: null,
        no_scaling: false,
      },
      instant: {
        label: 'Instant Funded',
        phases: [],
        funded: { daily_loss_pct: 3, max_dd_pct: 5, dd_type: 'trailing', profit_split: 90 },
        news_window_min: 16,
        weekend_hold: false,
        consistency_pct: 15,
        time_limit_days: null,
        min_hold_sec: 120,
        hold_deduct_threshold_pct: 25,
        safety_buffer_pct: 3,
        max_inactivity_days: 30,
        no_copy_trading: true,
        max_allocation: 300000,
        no_scaling: true,
      },
    },
  },
  custom: {
    name: 'Custom / Other',
    plans: {},
  },
};

export const FIRM_OPTIONS = Object.entries(PROP_FIRMS).map(([key, firm]) => ({
  value: key,
  label: firm.name,
}));

export function getPlanOptions(firmKey: string) {
  const firm = PROP_FIRMS[firmKey];
  if (!firm) return [];
  return Object.entries(firm.plans).map(([key, plan]) => ({
    value: key,
    label: plan.label,
  }));
}

export function getPreset(firmKey: string, planKey: string): PropPlanPreset | null {
  return PROP_FIRMS[firmKey]?.plans[planKey] ?? null;
}

export function getPhaseRules(
  preset: PropPlanPreset,
  phase: number,
): { daily_loss_pct: number; max_dd_pct: number; target_pct: number | null; dd_type: DrawdownType; min_trading_days: number } {
  if (phase === 0 || preset.phases.length === 0) {
    return {
      daily_loss_pct: preset.funded.daily_loss_pct,
      max_dd_pct: preset.funded.max_dd_pct,
      target_pct: null,
      dd_type: preset.funded.dd_type,
      min_trading_days: 0,
    };
  }
  const p = preset.phases[phase - 1];
  if (!p) return getPhaseRules(preset, 0);
  return {
    daily_loss_pct: p.daily_loss_pct,
    max_dd_pct: p.max_dd_pct,
    target_pct: p.profit_target_pct,
    dd_type: p.dd_type,
    min_trading_days: p.min_trading_days,
  };
}
