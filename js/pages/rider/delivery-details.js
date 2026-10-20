import { requireRole } from '../../core/guard.js';
import { renderNav } from '../../core/nav.js';

await requireRole('rider');
renderNav('rider', 'delivery-details');

// TODO: load data through a service, draw the screen, attach button handlers.
