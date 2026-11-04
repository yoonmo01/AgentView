/**
 * In-page replacement for window.confirm, built on the native <dialog> (focus trap, Esc to cancel).
 * Resolves true only when the confirm button is pressed.
 */
export function ask(message: string, ok = '지우기'): Promise<boolean> {
  const d = document.createElement('dialog');
  d.className = 'ask';
  const p = document.createElement('p');
  p.textContent = message;
  const bar = document.createElement('form');
  bar.method = 'dialog';
  bar.className = 'actions';
  const cancel = Object.assign(document.createElement('button'), { value: 'no', textContent: '취소' });
  const yes = Object.assign(document.createElement('button'), { value: 'yes', textContent: ok, className: 'danger' });
  bar.append(cancel, yes);
  d.append(p, bar);
  document.body.append(d);
  d.showModal();
  cancel.focus();
  return new Promise((resolve) => d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); }));
}
