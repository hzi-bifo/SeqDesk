"use client";

interface InlineFieldErrorProps {
  message: string;
}

export function InlineFieldError({ message }: InlineFieldErrorProps) {
  return (
    <div
      className="flex items-center gap-2 animate-in fade-in duration-150 relative z-10 rounded-b-md"
      style={{
        background: '#fef2f2',
        border: '1px solid #ef4444',
        borderTop: 'none',
        padding: '6px 12px',
        marginTop: '-9px',
      }}
    >
      <div
        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
        style={{ background: '#ef4444' }}
      />
      <span className="text-xs font-medium" style={{ color: '#dc2626' }}>
        {message}
      </span>
    </div>
  );
}
