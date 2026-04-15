import { Modal } from './modal.js';

export function confirmDialog(options = {}) {
  const {
    title = 'Confirm',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmClass = 'btn btn--primary',
    danger = false
  } = options;

  return new Promise((resolve) => {
    const modal = new Modal({
      title,
      content: `<p style="color: var(--c-text-secondary)">${message}</p>`,
      footer: `
        <button class="btn btn--secondary js-cancel">${cancelText}</button>
        <button class="${danger ? 'btn btn--danger' : confirmClass} js-confirm">${confirmText}</button>
      `,
      closable: true,
      onClose: () => resolve(false)
    });

    modal.render();

    modal.el.querySelector('.js-cancel').addEventListener('click', () => {
      modal.close();
      resolve(false);
    });

    modal.el.querySelector('.js-confirm').addEventListener('click', () => {
      modal.close();
      resolve(true);
    });
  });
}
