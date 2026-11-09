export function setupRadioCards(container) {
  const cards = container.querySelectorAll('.radio-card');
  cards.forEach((card) => {
    const radio = card.querySelector('input[type="radio"]');
    if (!radio) return;

    if (radio.checked) {
      card.classList.add('active');
    }

    card.addEventListener('click', (e) => {
      if (e.target !== radio) {
        radio.checked = true;
      }
      cards.forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
