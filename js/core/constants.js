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

// Streamlined 4-stage staff progress flow
export const STAFF_STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'preparing', label: 'Preparing / Assigned' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'completed', label: 'Completed' },
];

export const STAFF_STEP_OF = {
  submitted: 'submitted',
  confirmed: 'preparing',
  refilling: 'preparing',
  ready: 'preparing',
  rider_assigned: 'preparing',
  out_for_delivery: 'out_for_delivery',
  delivered: 'out_for_delivery',
  completed: 'completed',
  cancelled: 'submitted',
  attempted: 'out_for_delivery',
};

// Streamlined 4-stage customer tracking progress flow
export const CUSTOMER_STEPS = [
  { key: 'submitted', label: 'Order submitted' },
  { key: 'preparing', label: 'Preparing order' },
  { key: 'delivery', label: 'Out for delivery' },
  { key: 'completed', label: 'Completed' },
];

export const CUSTOMER_STEP_OF = {
  submitted: 'submitted',
  confirmed: 'preparing',
  refilling: 'preparing',
  ready: 'preparing',
  rider_assigned: 'preparing',
  out_for_delivery: 'delivery',
  delivered: 'delivery',
  completed: 'completed',
  cancelled: 'submitted',
  attempted: 'delivery',
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
