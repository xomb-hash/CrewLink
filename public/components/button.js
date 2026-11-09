export function createButton({
  text = '',
  variant = 'default', // 'primary' | 'secondary' | 'danger' | 'default'
  size = 'md',        // 'sm' | 'md' | 'lg'
  icon = '',
  onClick = null,
  disabled = false,
  type = 'button',
  href = null,
  className = ''
}) {
  const element = href ? document.createElement('a') : document.createElement('button');
  
  if (href) {
    element.href = href;
  } else {
    element.type = type;
  }

  element.className = `btn btn-${variant} ${size !== 'md' ? `btn-${size}` : ''} ${className}`.trim();
  element.disabled = disabled;

  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'btn-icon-wrapper';
    iconSpan.innerHTML = icon;
    element.appendChild(iconSpan);
  }

  if (text) {
    const textNode = document.createTextNode(text);
    element.appendChild(textNode);
  }

  if (onClick && typeof onClick === 'function') {
    element.addEventListener('click', onClick);
  }

  return element;
}
