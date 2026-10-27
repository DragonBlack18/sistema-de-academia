import type * as schema from '../../db/schema';

/** Raw D1 rows use the same column names and nullability as the Drizzle schema. */
type Schema = typeof schema;
export type TableRows = {
  [Name in keyof Schema as Schema[Name]['_']['name']]: Schema[Name]['$inferSelect'];
};

type Student = TableRows['students'] & {
  trainer_name: string | null;
  plan_name: string | null;
  membership_status: string | null;
  last_attendance: string | null;
};
type FinanceStudent = Pick<Student, 'id' | 'name' | 'email' | 'phone' | 'status' | 'version'>;
type Membership = TableRows['memberships'] & { student_name: string; plan_name: string };
type Invoice = TableRows['invoices'] & { student_name: string; is_overdue: boolean };
type Workout = TableRows['workouts'] & { student_name: string; trainer_name: string | null; item_count: number };
type Assessment = TableRows['assessments'] & { student_name: string; assessor_name: string | null; bmi: number };

/** Fields selected by the entity registry, including its computed projections. */
export type EntityRows = {
  students: Student | FinanceStudent;
  staff: TableRows['staff'] & { user_name: string | null };
  plans: TableRows['plans'] & { active_memberships: number };
  memberships: Membership;
  invoices: Invoice;
  expenses: TableRows['expenses'];
  exercises: TableRows['exercises'];
  workouts: Workout;
  assessments: Assessment;
  classes: TableRows['classes'] & { instructor_name: string | null; booked_count: number };
  products: TableRows['products'];
  suppliers: TableRows['suppliers'];
  purchases: TableRows['purchases'] & { supplier_name: string };
  sales: TableRows['sales'] & { student_name: string | null };
  leads: TableRows['leads'];
  notifications: TableRows['notifications'] & { recipient_name: string | null; is_read: number };
  audit: TableRows['audit_logs'] & { user_name: string | null };
  attendance: TableRows['attendance'] & { student_name: string; user_name: string | null };
  'access-events': TableRows['access_events'] & { student_name: string; user_name: string | null };
};

type EntityRelations = {
  students: {
    memberships: (TableRows['memberships'] & { plan_name: string })[];
    invoices: (TableRows['invoices'] & { is_overdue: boolean })[];
    attendance: TableRows['attendance'][];
    workouts: TableRows['workouts'][];
    assessments: TableRows['assessments'][];
  };
  memberships: { history: TableRows['membership_events'][] };
  invoices: { payments: TableRows['payments'][]; refunds: TableRows['refunds'][] };
  workouts: {
    items: (TableRows['workout_items'] & { exercise_name: string; muscle_group: string })[];
    history: TableRows['workout_history'][];
    sessions: TableRows['workout_sessions'][];
  };
  classes: { bookings: (TableRows['bookings'] & { student_name: string })[] };
  products: { movements: (TableRows['stock_movements'] & { user_name: string | null })[] };
  purchases: { items: (TableRows['purchase_items'] & { product_name: string })[] };
  sales: { items: (TableRows['sale_items'] & { product_name: string })[] };
};

export type EntityDetail<Name extends keyof EntityRows> = EntityRows[Name] &
  (Name extends keyof EntityRelations ? EntityRelations[Name] : Record<never, never>);
