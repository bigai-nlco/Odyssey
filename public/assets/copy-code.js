const copyIcon = '<svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5h6v8h-6z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.5 11.5h-1v-8h6v1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const checkIcon = '<svg class="check-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8 3 3 6.5-6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Copy command was unsuccessful.');
}

function setCopiedState(button) {
  button.classList.add('is-copied');
  button.setAttribute('aria-label', 'Copied');
  button.title = 'Copied';
  window.setTimeout(() => {
    button.classList.remove('is-copied');
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code';
  }, 2000);
}

document.querySelectorAll('.article-body pre > code').forEach((code) => {
  const pre = code.parentElement;
  const button = document.createElement('button');
  button.className = 'copy-code-button';
  button.type = 'button';
  button.setAttribute('aria-label', 'Copy code');
  button.title = 'Copy code';
  button.innerHTML = copyIcon + checkIcon;
  button.addEventListener('click', async () => {
    try {
      await copyText(code.textContent || '');
      setCopiedState(button);
    } catch {
      button.setAttribute('aria-label', 'Unable to copy code');
      button.title = 'Unable to copy code';
    }
  });
  pre.append(button);
});
