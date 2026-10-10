import Icon from './Icon';

export default function ThemeToggle({ theme, onToggle, className = '' }) {
  const dark = theme === 'dark';
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
  return <button
    type="button"
    className={`icon-button theme-toggle ${className}`.trim()}
    aria-label={label}
    title={label}
    onClick={onToggle}
  ><Icon name={dark ? 'sun' : 'moon'} /></button>;
}
