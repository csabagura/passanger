// Single source of truth for all app-wide constants
// All AI agents must import constants from here — never scatter magic values in components

export const SUPPORTED_UNITS = ['L/100km', 'MPG'] as const;
export type FuelUnit = (typeof SUPPORTED_UNITS)[number];

export const PRESET_CURRENCIES = ['€', '$', '£', 'Ft'] as const;
export type PresetCurrency = (typeof PRESET_CURRENCIES)[number];

export const DEFAULT_UNIT: FuelUnit = 'L/100km';
export const DEFAULT_CURRENCY: string = '€';

// Currency display metadata, keyed by the currency string trimmed + upper-cased.
// Currencies whose minor unit is absent/negligible are shown with no decimal places.
export const ZERO_DECIMAL_CURRENCIES = new Set([
	'HUF',
	'FT',
	'JPY',
	'¥',
	'KRW',
	'₩',
	'CLP',
	'ISK',
	'VND'
]);
// Currency symbols conventionally written after the amount (e.g. "20000 Ft").
export const SUFFIX_CURRENCIES = new Set(['FT', 'HUF', 'KR', 'ZŁ', 'KČ']);

export const DB_NAME = 'passangerDB'; // Note: double-a brand name — NOT 'passengerDB'
export const DB_VERSION = 4;

// Full-dataset JSON backup. `BACKUP_APP_ID` tags exported files so a restore can reject a
// foreign file; the schemaVersion in a backup reuses DB_VERSION (exact-match on restore).
export const BACKUP_APP_ID = 'passanger';
export const BACKUP_FILENAME_PREFIX = 'passanger-backup';

export const MAX_VEHICLES = 5;

// Service-reminder "due soon" thresholds — a reminder switches from ok → due-soon once
// the remaining distance/time falls at or below these, and → overdue at/below zero.
export const REMINDER_DUE_SOON_KM = 500;
export const REMINDER_DUE_SOON_DAYS = 14;
export const MAX_CSV_ROWS = 10_000;
export const IMPORT_FILE_SIZE_WARN_BYTES = 5 * 1024 * 1024; // 5MB — show amber warning
export const IMPORT_FILE_SIZE_MAX_BYTES = 10 * 1024 * 1024; // 10MB — hard reject
export const TOAST_DURATION_MS = 4000; // default sonner toast auto-dismiss (success/error)
export const TOAST_UNDO_DURATION_MS = 5000; // action (Undo) toast window — reused by FR-7/AD-7
export const SETTINGS_STORAGE_KEY = 'passanger_settings'; // localStorage key for settings
export const VEHICLE_ID_STORAGE_KEY = 'passanger_vehicle_id'; // localStorage key for selected vehicle
export const HISTORY_ENTRY_FILTER_STORAGE_KEY = 'passanger_history_entry_filter'; // sessionStorage key for History tab filter
export const STORAGE_PERSISTENCE_OUTCOME_KEY = 'passanger_storage_outcome'; // localStorage key for storage persistence outcome
export const STORAGE_NOTICE_DISMISSED_KEY = 'passanger_storage_notice_dismissed'; // localStorage key for notice dismissal
export const INSTALL_PROMPT_DISMISSED_KEY = 'passanger_install_prompt_dismissed'; // localStorage key for install prompt dismissal
export const ONBOARDING_SURVEY_STORAGE_KEY = 'passanger_onboarding_survey'; // localStorage key for onboarding survey state
export const SESSION_COUNT_STORAGE_KEY = 'passanger_session_count'; // localStorage key for session count (install nudge timing)
export const TAB_SYNC_CHANNEL = 'passanger_tab_sync'; // BroadcastChannel name for cross-tab reconciliation
export const TAB_SYNC_CUE_DURATION_MS = 4000; // auto-dismiss duration for the "updated in another tab" cue
export const SHELL_NAVBAR_HEIGHT = '4rem';
export const UPDATE_PROMPT_CLEARANCE = '4rem';
// Story 2.1: the global Capture FAB (56px) floats ~12px above the nav, so it pokes ~68px above the
// nav line. Page content must reserve that band as bottom padding, otherwise the last control on a
// page (e.g. a form's Save button) sits underneath the FAB and can't be tapped. 5rem clears the
// FAB's top edge with a little breathing room.
export const SHELL_FAB_CLEARANCE = '5rem';
export const APP_SHELL_MAIN_PADDING = `calc(${SHELL_NAVBAR_HEIGHT} + ${SHELL_FAB_CLEARANCE} + env(safe-area-inset-bottom, 0px))`;
export const APP_SHELL_MAIN_PADDING_WITH_UPDATE_PROMPT = `calc(${SHELL_NAVBAR_HEIGHT} + ${UPDATE_PROMPT_CLEARANCE} + ${SHELL_FAB_CLEARANCE} + env(safe-area-inset-bottom, 0px))`;
// The update banner sits directly above the nav (NOT above the FAB), so its offset stays nav-only —
// decoupled from the content padding, which now also carries the FAB clearance.
export const UPDATE_PROMPT_BOTTOM_OFFSET = `calc(${SHELL_NAVBAR_HEIGHT} + env(safe-area-inset-bottom, 0px))`;

// Capture (Story 2.1): query param that deep-links the global Capture sheet open on a segment,
// e.g. /history?capture=fuel. Stripped from the URL via replaceState right after opening.
export const CAPTURE_DEEP_LINK_PARAM = 'capture';

// Capture smart defaults (Story 2.2 / FR-4): thresholds for the NON-blocking "implausibly
// high" odometer sanity warning. A reading warns (never blocks) when the delta above the
// previous reading exceeds max(typicalDelta * MULTIPLIER, MIN_DELTA). The multiplier scales
// with the vehicle's own median inter-fill delta; the floor keeps low-mileage vehicles and
// the no-history case from false-warning. Both only gate the SOFT amber warning — Save is
// always allowed. In the entry's distance unit (km or mi).
export const ODOMETER_IMPLAUSIBLE_DELTA_MULTIPLIER = 5;
export const ODOMETER_IMPLAUSIBLE_MIN_DELTA = 2000;

// Durable Capture drafts (Story 2.3 / FR-5, AD-6): the in-progress Fuel/Expense forms are
// written through to localStorage (synchronously, last-keystroke-durable) so a reload, a
// backgrounded tab, or a PWA cold-start never loses a half-typed entry. Each key stores
// `{ fields, updatedAt }`. Follows the `passanger_<area>_<name>` key convention above.
export const DRAFT_FUEL_STORAGE_KEY = 'passanger_draft_fuel'; // localStorage key for the fuel draft
export const DRAFT_EXPENSE_STORAGE_KEY = 'passanger_draft_expense'; // localStorage key for the expense draft
export const DRAFT_CURRENCY_STORAGE_KEY = 'passanger_capture_currency'; // localStorage key for durable currency memory
// A restored draft older than this re-validates its odometer (and, for expense, its date)
// rather than silently resurfacing a stale reading. 7 days: long enough that a normal
// interrupted-then-resumed entry restores verbatim, short enough that a genuinely abandoned
// half-entry re-derives a fresh suggestion. Pure tuning knob (Story 2.3 Open Question 1).
export const DRAFT_STALE_DAYS = 7;
