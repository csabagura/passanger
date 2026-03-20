// Single source of truth for all app-wide constants
// All AI agents must import constants from here — never scatter magic values in components

export const SUPPORTED_UNITS = ['L/100km', 'MPG'] as const;
export type FuelUnit = (typeof SUPPORTED_UNITS)[number];

export const PRESET_CURRENCIES = ['€', '$', '£'] as const;
export type PresetCurrency = (typeof PRESET_CURRENCIES)[number];

export const DEFAULT_UNIT: FuelUnit = 'L/100km';
export const DEFAULT_CURRENCY: string = '€';

export const DB_NAME = 'passangerDB'; // Note: double-a brand name — NOT 'passengerDB'
export const DB_VERSION = 2;

export const MAX_VEHICLES = 5;
export const MAX_CSV_ROWS = 10_000;
export const IMPORT_FILE_SIZE_WARN_BYTES = 5 * 1024 * 1024; // 5MB — show amber warning
export const IMPORT_FILE_SIZE_MAX_BYTES = 10 * 1024 * 1024; // 10MB — hard reject
export const RESULT_CARD_DISMISS_MS = 3000; // inline result card auto-dismiss duration
export const SETTINGS_STORAGE_KEY = 'passanger_settings'; // localStorage key for settings
export const VEHICLE_ID_STORAGE_KEY = 'passanger_vehicle_id'; // localStorage key for selected vehicle
export const HISTORY_ENTRY_FILTER_STORAGE_KEY = 'passanger_history_entry_filter'; // sessionStorage key for History tab filter
export const STORAGE_PERSISTENCE_OUTCOME_KEY = 'passanger_storage_outcome'; // localStorage key for storage persistence outcome
export const STORAGE_NOTICE_DISMISSED_KEY = 'passanger_storage_notice_dismissed'; // localStorage key for notice dismissal
export const INSTALL_PROMPT_DISMISSED_KEY = 'passanger_install_prompt_dismissed'; // localStorage key for install prompt dismissal
export const ONBOARDING_SURVEY_STORAGE_KEY = 'passanger_onboarding_survey'; // localStorage key for onboarding survey state
export const SESSION_COUNT_STORAGE_KEY = 'passanger_session_count'; // localStorage key for session count (install nudge timing)
export const SHELL_NAVBAR_HEIGHT = '4rem';
export const UPDATE_PROMPT_CLEARANCE = '4rem';
export const APP_SHELL_MAIN_PADDING = `calc(${SHELL_NAVBAR_HEIGHT} + env(safe-area-inset-bottom, 0px))`;
export const APP_SHELL_MAIN_PADDING_WITH_UPDATE_PROMPT = `calc(${SHELL_NAVBAR_HEIGHT} + ${UPDATE_PROMPT_CLEARANCE} + env(safe-area-inset-bottom, 0px))`;
export const UPDATE_PROMPT_BOTTOM_OFFSET = APP_SHELL_MAIN_PADDING;
