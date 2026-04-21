/**
 * Shared defaults for the dynamic price target algorithm.
 * These constants are used by the daemon for live decisions and by
 * evaluation scripts for simulation/replay.
 */

/** Days of history to analyze for house load patterns. */
export const DYNAMIC_PRICE_TARGET_HISTORY_LOOKBACK_DAYS = 14;

/** Maximum same-weekday matches to include in history analysis. */
export const DYNAMIC_PRICE_TARGET_MAX_SAME_WEEKDAY_MATCHES = 4;

/** Time period granularity for predictions (minutes). */
export const DYNAMIC_PRICE_TARGET_PERIOD_MINUTES = 15;

/** Minimum solar surplus (watts) required before solar counts as recovery. */
export const DYNAMIC_PRICE_TARGET_MIN_SOLAR_SURPLUS_W = 50;

/** SOC change threshold for inferring battery direction (percent). */
export const DYNAMIC_PRICE_TARGET_SOC_DIRECTION_EPSILON_PERCENT = 0.05;

/** Default manual discharge/charge power in watts. */
export const DEFAULT_MANUAL_STRATEGY_POWER_W = 2400;

/** Minimum current site solar production required to start low-price charging. */
export const LOW_PRICE_CHARGE_MIN_SITE_SOLAR_POWER_W = 500;

/** Fixed backup reserve margin used by live dynamic price targeting. */
export const DYNAMIC_PRICE_TARGET_BACKUP_RESERVE_MARGIN_PERCENT = 2;

/**
 * Target buffer percentage per hour until target time.
 * For high-price windows: hoursUntilTarget * this value, rounded to nearest whole percent.
 */
export const DYNAMIC_PRICE_TARGET_BUFFER_PERCENT_PER_HOUR = 0.5;
