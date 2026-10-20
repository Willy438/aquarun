// Toast, modal, date and peso formatting.
export function formatPeso(value) {
  return '₱' + Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
