/** Shapes returned by the domain API. Dynamic column names remain unknown until displayed. */
export interface EntityItem {
  id?: string;
  exercise_id?: string;
  exercise_name?: string;
  product_id?: string;
  product_name?: string;
  name?: string;
  day?: string;
  sets?: number;
  reps?: string;
  load?: string;
  rest_seconds?: number;
  notes?: string;
  quantity?: number;
  unit_cost_cents?: number;
  unit_price_cents?: number;
}

export interface EntityRecord {
  [key: string]: unknown;
  id: string;
  version?: number;
  name?: string;
  title?: string;
  description?: string;
  email?: string;
  role?: string;
  status?: string;
  active?: boolean;
  student_id?: string;
  student_name?: string;
  instructor_id?: string;
  instructor_name?: string;
  supplier_name?: string;
  plan_name?: string;
  objective?: string;
  notes?: string;
  location?: string;
  created_at?: string;
  updated_at?: string;
  starts_at?: string;
  paid_at?: string;
  check_in?: string;
  check_out?: string | null;
  access_start?: string;
  access_end?: string;
  payment_method?: string;
  summary?: string;
  reason?: string;
  event?: string;
  snapshot?: string;
  amount_cents?: number;
  total_cents?: number;
  price_cents?: number;
  cost_cents?: number;
  stock?: number;
  capacity?: number;
  booked_count?: number;
  is_overdue?: boolean;
  is_read?: boolean;
  items?: EntityItem[];
  sessions?: EntityRecord[];
  payments?: EntityRecord[];
  refunds?: EntityRecord[];
  movements?: EntityRecord[];
  history?: EntityRecord[];
  bookings?: BookingRecord[];
  memberships?: EntityRecord[];
  invoices?: EntityRecord[];
  attendance?: EntityRecord[];
  workouts?: EntityRecord[];
  assessments?: EntityRecord[];
}

export interface LookupOption {
  id: string;
  name: string;
  role?: string;
  price_cents?: number;
  cost_cents?: number;
  stock?: number;
}

export interface BookingRecord extends EntityRecord {
  student_id: string;
}

export interface RevenuePoint { date: string; revenue: number; expenses: number }
export interface AttendancePoint { date: string; count: number }
export interface PlanCount { name: string; value: number }
export interface ReportData {
  period: { days: number; from: string; to: string };
  totals: {
    received_cents: number;
    refunded_cents: number;
    expenses_cents: number;
    net_cents: number;
    open_cents: number;
    overdue_cents: number;
    sales_cents: number;
    attendance_count: number;
    new_students: number;
  };
  revenue: RevenuePoint[];
  attendance: AttendancePoint[];
  planDistribution: PlanCount[];
}

export interface DashboardData {
  metrics: {
    activeStudents: number;
    monthlyRevenue: number;
    openInvoices: number;
    todayAttendance: number;
    overdueAmount: number;
    occupancy: number;
  };
  revenue: RevenuePoint[];
  attendance: AttendancePoint[];
  planDistribution: PlanCount[];
  recentActivity: { id: string; summary: string; user_name: string | null; created_at: string }[];
  upcomingClasses: { id: string; name: string; starts_at: string; instructor_name: string | null; location: string | null; booked_count: number; capacity: number }[];
  pendingInvoices: EntityRecord[];
}
