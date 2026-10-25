// Statuses, roles and the customer tracker mapping (Section 4.2).
export const ROLES = { CUSTOMER: 'customer', STAFF: 'staff', RIDER: 'rider', ADMIN: 'admin' };

export const ORDER_STATUS = {
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  REFILLING: 'refilling',
  READY: 'ready',
  RIDER_ASSIGNED: 'rider_assigned',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  ATTEMPTED: 'attempted',
  CANCELLED: 'cancelled',
};

// All 8 internal statuses for Staff & Rider progress bar (Section 4.1).
export const STAFF_STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'refilling', label: 'Refilling' },
  { key: 'ready', label: 'Ready' },
  { key: 'rider_assigned', label: 'Rider assigned' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Completed' },
];

// The 8 internal statuses mapped to the 6 steps the customer sees (Section 4.2).
export const CUSTOMER_STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'refilling', label: 'Refilling' },
  { key: 'ready', label: 'Ready' },
  { key: 'delivery', label: 'Out for delivery' },
  { key: 'completed', label: 'Completed' },
];

export const CUSTOMER_STEP_OF = {
  submitted: 'submitted',
  confirmed: 'confirmed',
  refilling: 'refilling',
  ready: 'ready',
  rider_assigned: 'ready',
  out_for_delivery: 'delivery',
  delivered: 'delivery',
  completed: 'completed',
};

export const STATUS_LABELS = {
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  refilling: 'Refilling',
  ready: 'Ready',
  rider_assigned: 'Rider assigned',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Completed',
  attempted: 'Attempted',
  cancelled: 'Cancelled',
};

export const CUSTOMER_STATUS_HEADINGS = {
  submitted: 'Order submitted',
  confirmed: 'Order confirmed',
  refilling: 'Being refilled',
  ready: 'Ready for delivery',
  rider_assigned: 'Rider assigned',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  completed: 'Completed',
  attempted: 'Delivery attempted',
  cancelled: 'Order cancelled',
};

export const STATUS_PILL_TONE = {
  submitted: 'neutral',
  confirmed: 'blue',
  refilling: 'amber',
  ready: 'blue',
  rider_assigned: 'blue',
  out_for_delivery: 'blue',
  delivered: 'green',
  completed: 'green',
  attempted: 'amber',
  cancelled: 'danger',
};

// Where each role lands after logging in.
export const ROLE_HOME = {
  customer: 'customer/home.html',
  staff: 'staff/dashboard.html',
  rider: 'rider/my-deliveries.html',
  admin: 'admin/dashboard.html',
};
