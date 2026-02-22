class RallyHeader extends HTMLElement {
  connectedCallback() {
    const mode = this.getAttribute('mode');
    this.innerHTML = `
      <header id="site-header">
        <div class="header-brand">
          <h1 class="logo">RallyLab</h1>
          ${mode ? `<span class="header-mode">${mode}</span>` : ''}
          <nav id="breadcrumbs" aria-label="Breadcrumb"></nav>
        </div>
        <div id="user-info"></div>
      </header>
      ${mode === 'Operator' ? `
      <div id="live-bar" class="live-bar hidden">
        <span class="live-badge"></span>
        <span id="live-bar-text">Race in progress</span>
        <button class="btn btn-sm" id="live-bar-btn">Return to Live Console</button>
      </div>` : ''}`;
  }
}

customElements.define('rally-header', RallyHeader);
