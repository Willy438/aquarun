import { requireRole } from '../../core/guard.js';
import { renderNav } from '../../core/nav.js';

await requireRole('rider');
renderNav('rider', 'my-deliveries');

// TODO: load data through a service, draw the screen, attach button handlers.
