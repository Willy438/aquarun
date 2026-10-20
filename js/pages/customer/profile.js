import { requireRole } from '../../core/guard.js';
import { renderNav } from '../../core/nav.js';

await requireRole('customer');
renderNav('customer', 'profile');

// TODO: load data through a service, draw the screen, attach button handlers.
