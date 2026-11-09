export function renderFooter(container) {
  if (!container) return;

  container.innerHTML = `
    <footer class="footer">
      <div class="container">
        <p>Crewlink &bull; Connect people to build together around GitHub repositories.</p>
      </div>
    </footer>
  `;
}
