import { requireRole } from '../../core/guard.js';
import { renderNav } from '../../core/nav.js';

await requireRole('customer');
renderNav('customer', 'bottle-balance');

// TODO: load data through a service, draw the screen, attach button handlers.
