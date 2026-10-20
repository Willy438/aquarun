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
  CANCELLED: 'cancelled',
};

// The 8 internal statuses mapped to the 6 steps the customer sees.
export const CUSTOMER_STEPS = ['submitted', 'confirmed', 'refilling', 'ready', 'delivery', 'completed'];
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
