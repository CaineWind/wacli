type PiLogoProps = { className?: string };

export default function PiLogo({ className = 'h-5 w-5' }: PiLogoProps) {
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-flex items-center justify-center font-serif font-bold leading-none text-emerald-600 dark:text-emerald-400`}
    >
      π
    </span>
  );
}
