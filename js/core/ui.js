// Toast, modal, date and peso formatting.
export function formatPeso(value) {
  return '₱' + Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Small shared helpers: toast messages and button loading state.
export function showToast(message, type = 'info') {
  let root = document.querySelector('.toast-root');
  if (!root) {
    root = document.createElement('div');
    root.className = 'toast-root';
    document.body.append(root);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  root.append(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
  } else {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
}
