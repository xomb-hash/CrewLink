export function createDialog({
  title = '',
  content = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
  onConfirm = null,
  onCancel = null
}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';

  backdrop.innerHTML = `
    <div class="dialog-modal" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <h3 class="dialog-title">${title}</h3>
        <button type="button" class="dialog-close" aria-label="Close dialog">&times;</button>
      </div>
      <div class="dialog-body">
        ${typeof content === 'string' ? content : ''}
      </div>
      <div class="dialog-footer">
        <button type="button" class="btn btn-secondary dialog-btn-cancel">${cancelText}</button>
        <button type="button" class="btn btn-${confirmVariant} dialog-btn-confirm">${confirmText}</button>
      </div>
    </div>
  `;

  if (typeof content !== 'string' && content instanceof HTMLElement) {
    backdrop.querySelector('.dialog-body').appendChild(content);
  }

  function close() {
    backdrop.classList.remove('open');
    setTimeout(() => backdrop.remove(), 200);
  }

  backdrop.querySelector('.dialog-close').addEventListener('click', () => {
    if (onCancel) onCancel();
    close();
  });

  backdrop.querySelector('.dialog-btn-cancel').addEventListener('click', () => {
    if (onCancel) onCancel();
    close();
  });

  backdrop.querySelector('.dialog-btn-confirm').addEventListener('click', async () => {
    if (onConfirm) {
      const result = await onConfirm();
      if (result !== false) close();
    } else {
      close();
    }
  });

  // Close when clicking outside modal
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      if (onCancel) onCancel();
      close();
    }
  });

  document.body.appendChild(backdrop);
  // Trigger animation
  requestAnimationFrame(() => backdrop.classList.add('open'));

  return { close };
}
