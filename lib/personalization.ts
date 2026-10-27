/** Shared, framework-free personalization contract. No credentials or executable CSS. */
export const PAGE_KEYS = ['dashboard', 'students', 'staff', 'plans', 'memberships', 'invoices', 'expenses', 'attendance', 'workouts', 'exercises', 'assessments', 'classes', 'products', 'suppliers', 'purchases', 'sales', 'leads', 'notifications', 'users', 'audit', 'access-events', 'reports', 'settings'] as const;
export type PageKey = typeof PAGE_KEYS[number];
export const ROLES = ['super_admin', 'admin', 'manager', 'reception', 'finance', 'trainer', 'personal'] as const;
export type Role = typeof ROLES[number];
export const ICON_NAMES = ['Activity', 'BarChart3', 'Users', 'Dumbbell', 'CalendarDays', 'Wallet', 'LayoutDashboard', 'Package', 'Bell', 'Settings', 'ShieldCheck', 'UserRound', 'HeartPulse', 'ClipboardList', 'TrendingUp', 'Building2', 'CreditCard', 'Target', 'ShoppingBag', 'Zap', 'ChartNoAxesCombined', 'Settings2', 'BadgeCheck', 'DoorOpen', 'History', 'Layers', 'MessagesSquare', 'Receipt', 'ScanLine', 'ShoppingCart', 'Truck', 'UserRoundCog'] as const;
export type ThemeMode = 'dark' | 'light' | 'system';
export type FontFamily = 'manrope' | 'inter' | 'system';
export type PreferenceValues = {
  themeMode: ThemeMode;
  font: FontFamily;
  sidebarPosition: 'left' | 'right';
  sidebarMode: 'expanded' | 'compact';
  tableDensity: 'comfortable' | 'compact';
  textScale: 100 | 110 | 120;
  reducedMotion: 'system' | 'reduce';
  reducedTransparency: boolean;
  homePage: PageKey;
  favorites: PageKey[];
};
/** Omitted fields inherit the role defaults, then academy defaults. PATCH replaces this object. */
export type UserPreferences = Partial<PreferenceValues>;
export type GymSettings = {
  gymName: string; tagline: string; font: FontFamily;
  sidebarPosition: 'left' | 'right'; iconStyle: 'outline' | 'solid'; iconOverrides: Record<string, string>;
  accentColor: string; backgroundColor: string; lightBackgroundColor: string; themeMode: ThemeMode;
  cornerStyle: 'soft' | 'square';
  logoAssetId: string | null; logoDarkAssetId: string | null; logoLightAssetId: string | null;
  logoLayout: 'symbol' | 'horizontal'; showGymName: boolean; faviconAssetId: string | null;
  wallpaperAssetId: string | null; wallpaperOpacity: number; wallpaperPosition: 'top' | 'center' | 'bottom';
  loginImageAssetId: string | null; loginImagePosition: 'top' | 'center' | 'bottom'; loginLayout: 'split' | 'centered';
  loginTitle: string; loginSubtitle: string; loginWelcomeTitle: string; loginWelcomeMessage: string;
  accessGraceDays: number; roleDefaults: Partial<Record<Role, UserPreferences>>;
};
export type AppearanceSettings = Omit<GymSettings, 'accessGraceDays' | 'roleDefaults'>;
export const DEFAULT_SETTINGS: GymSettings = {
  gymName: 'Vitality Gym', tagline: 'Movimento que transforma.', font: 'manrope', sidebarPosition: 'left',
  iconStyle: 'outline', iconOverrides: {}, accentColor: '#b9f36b', backgroundColor: '#101211', lightBackgroundColor: '#f3f5f4', themeMode: 'dark', cornerStyle: 'soft',
  logoAssetId: null, logoDarkAssetId: null, logoLightAssetId: null, logoLayout: 'symbol', showGymName: true, faviconAssetId: null,
  wallpaperAssetId: null, wallpaperOpacity: 0.12, wallpaperPosition: 'center',
  loginImageAssetId: null, loginImagePosition: 'center', loginLayout: 'split',
  loginTitle: 'Você cuida das pessoas. A gente conecta a sua gestão.', loginSubtitle: 'Alunos, treinos e resultados. Toda a sua academia no mesmo ritmo.',
  loginWelcomeTitle: 'Bom ter você de volta.', loginWelcomeMessage: 'Entre para acompanhar o movimento da sua academia.',
  accessGraceDays: 3, roleDefaults: {},
};
export const APPEARANCE_KEYS = Object.keys(DEFAULT_SETTINGS).filter(key => key !== 'accessGraceDays' && key !== 'roleDefaults') as (keyof AppearanceSettings)[];
export const ASSET_FIELDS = ['logoAssetId', 'logoDarkAssetId', 'logoLightAssetId', 'faviconAssetId', 'wallpaperAssetId', 'loginImageAssetId'] as const;
export function appearanceOf(settings: GymSettings): AppearanceSettings {
  const { accessGraceDays: _grace, roleDefaults: _roles, ...appearance } = settings;
  void _grace; void _roles;
  return appearance;
}
export function resolvePreferences(settings: GymSettings, role: string | undefined, preferences: UserPreferences = {}): PreferenceValues {
  const defaults: PreferenceValues = { themeMode: settings.themeMode, font: settings.font, sidebarPosition: settings.sidebarPosition, sidebarMode: 'expanded', tableDensity: 'comfortable', textScale: 100, reducedMotion: 'system', reducedTransparency: false, homePage: 'dashboard', favorites: [] };
  return { ...defaults, ...(role ? settings.roleDefaults[role as Role] : {}), ...preferences };
}
export type SettingsHistoryEntry = { version: number; settings: GymSettings; created_at: string; user_name: string | null; source: string; restored_from: number | null; changed_keys: string[] };
export type AppearanceTheme = { id: string; name: string; kind: 'theme' | 'draft'; settings: AppearanceSettings; version: number; created_at: string; updated_at: string; created_by: string };
export type BrandingAsset = { id: string; name: string; kind: 'logo' | 'wallpaper'; mime: string; size: number; url: string; created_at: string; inUse: boolean };
export type PersonalizationPage<T> = { data: T[]; total: number; page: number; pageSize: number };
