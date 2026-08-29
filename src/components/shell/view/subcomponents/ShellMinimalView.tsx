import type { RefObject } from 'react';

type ShellMinimalViewProps = {
  terminalContainerRef: RefObject<HTMLDivElement>;
};

export default function ShellMinimalView({
  terminalContainerRef,
}: ShellMinimalViewProps) {
  return (
    <div className="relative h-full w-full bg-gray-900">
      <div
        ref={terminalContainerRef}
        className="h-full w-full pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] focus:outline-none md:pb-0"
        style={{ outline: 'none' }}
      />
    </div>
  );
}
