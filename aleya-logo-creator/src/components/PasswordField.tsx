import { useId, useState } from 'react';

type Props = {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
};

export function PasswordField({
  name,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  required = true,
  minLength = 8,
}: Props) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <span className="password-wrap">
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          <EyeIcon open={visible} />
        </button>
      </span>
    </label>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 3l18 18M10.5 10.6a2.5 2.5 0 003 3M9.4 5.1A10.5 10.5 0 0121 12c-.6 1.1-1.4 2.1-2.3 3M6.2 6.2C4.4 7.6 3 9.6 2.2 12c1.7 4.2 5.7 7 9.8 7 1.4 0 2.8-.3 4-.9"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.2 12C3.9 7.8 7.9 5 12 5s8.1 2.8 9.8 7c-1.7 4.2-5.7 7-9.8 7s-8.1-2.8-9.8-7z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
