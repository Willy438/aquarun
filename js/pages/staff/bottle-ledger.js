import { requireRole } from '../../core/guard.js';
import { renderNav } from '../../core/nav.js';

await requireRole('staff');
renderNav('staff', 'bottle-ledger');

// TODO: load data through a service, draw the screen, attach button handlers.
